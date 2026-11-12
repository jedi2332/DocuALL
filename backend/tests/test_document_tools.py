import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
import server
import storage
import document_tools

OWNER = 'owner-device-123'
OTHER = 'other-device-456'

def pdf(*labels):
    out = io.BytesIO()
    c = canvas.Canvas(out)
    for label in labels:
        c.drawString(50, 700, label)
        c.showPage()
    c.save()
    return out.getvalue()

class DocumentToolsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.patches = [patch.object(storage, 'DATA_DIR', root),
                        patch.object(storage, 'FILES_DIR', root/'files'),
                        patch.object(storage, 'DB_PATH', root/'db.json')]
        for p in self.patches: p.start()
        self.client = TestClient(server.app)
        self.a = self.add(OWNER, pdf('FIRST', 'SECOND'))
        self.b = self.add(OWNER, pdf('THIRD'))
        self.other = self.add(OTHER, pdf('PRIVATE'))

    def tearDown(self):
        self.client.close()
        for p in reversed(self.patches): p.stop()
        self.temp.cleanup()

    def add(self, owner, raw):
        path = storage.save_file(owner, storage.new_id()+'.pdf', raw)
        return storage.create_document(dict(owner_id=owner,title='Original',kind='imported',
            page_paths=[],pdf_path=path,thumbnail_path=None,page_count=2,deleted_at=None))

    def page(self, doc, index=0, rotation=0):
        return dict(document_id=doc['id'],page_index=index,rotation=rotation)

    def send(self, pages, title='New copy'):
        return self.client.post('/api/documents/assemble',headers={'X-Device-Id':OWNER},json=dict(title=title,pages=pages))

    def test_merge_reorder_rotate_and_original_unchanged(self):
        original = storage.read_file(self.a['pdf_path'])
        result = self.send([self.page(self.b),self.page(self.a,1,90),self.page(self.a,0)])
        self.assertEqual(result.status_code,200,result.text)
        doc=result.json()
        self.assertEqual(doc['page_count'],3)
        reader=PdfReader(io.BytesIO(storage.read_file(doc['pdf_path'])))
        self.assertEqual([p.extract_text().strip() for p in reader.pages],['THIRD','SECOND','FIRST'])
        self.assertEqual(reader.pages[1].rotation,0)
        self.assertGreater(float(reader.pages[1].mediabox.width),float(reader.pages[1].mediabox.height))
        self.assertEqual(storage.read_file(self.a['pdf_path']),original)
        self.assertNotEqual(doc['id'],self.a['id'])

    def test_extract_keeps_only_selected_page(self):
        result=self.send([self.page(self.a,1)])
        reader=PdfReader(io.BytesIO(storage.read_file(result.json()['pdf_path'])))
        self.assertEqual(len(reader.pages),1)
        self.assertEqual(reader.pages[0].extract_text().strip(),'SECOND')

    def test_authorizes_all_sources_before_reading(self):
        with patch('storage.read_file') as read:
            result=self.send([self.page(self.a),self.page(self.other)])
            self.assertEqual(result.status_code,404)
            read.assert_not_called()

    def test_deleted_source_denied(self):
        storage.hard_delete_document(self.a['id'],OWNER)
        self.assertEqual(self.send([self.page(self.a)]).status_code,404)

    def test_invalid_selection_never_creates_files(self):
        before=set(storage.FILES_DIR.rglob('*'))
        for pages in [[], [self.page(self.a,99)], [self.page(self.a,-1)], [self.page(self.a,0,45)], [self.page(self.a)]*2]:
            with self.subTest(pages=pages):
                self.assertEqual(self.send(pages).status_code,422)
        self.assertEqual(set(storage.FILES_DIR.rglob('*')),before)
        self.assertEqual(self.send([self.page(self.a)],'   ').status_code,422)

    def test_oversize_rejected_before_reading(self):
        with patch.object(document_tools,'MAX_SOURCE_BYTES',1),patch('storage.read_file') as read:
            self.assertEqual(self.send([self.page(self.a)]).status_code,413)
            read.assert_not_called()

    def test_corrupt_and_encrypted_sources_rejected(self):
        bad=self.add(OWNER,b'not a PDF')
        self.assertEqual(self.send([self.page(bad)]).status_code,422)
        writer=PdfWriter();writer.add_blank_page(100,100);writer.encrypt('secret')
        out=io.BytesIO();writer.write(out)
        encrypted=self.add(OWNER,out.getvalue())
        result=self.send([self.page(encrypted)])
        self.assertEqual(result.status_code,422)
        self.assertIn('Unlock',result.json()['detail'])

    def test_write_failure_cleans_new_files(self):
        before=set(storage.FILES_DIR.rglob('*'))
        with patch('storage.create_document',side_effect=RuntimeError('disk full')):
            with self.assertRaises(RuntimeError):
                self.send([self.page(self.a)])
        self.assertEqual(set(storage.FILES_DIR.rglob('*')),before)

    def test_bad_import_leaves_no_files(self):
        before=set(storage.FILES_DIR.rglob('*'))
        for raw in [b'not a pdf', b'']:
            result=self.client.post('/api/documents/import-pdf',headers={'X-Device-Id':OWNER},
                files={'file':('bad.pdf',raw,'application/pdf')})
            self.assertIn(result.status_code,[400,422])
        self.assertEqual(set(storage.FILES_DIR.rglob('*')),before)

    def test_created_pdf_is_private(self):
        result=self.send([self.page(self.a)]).json()
        url='/api/files/'+result['pdf_path']
        self.assertEqual(self.client.get(url,params={'device':OWNER}).status_code,200)
        self.assertEqual(self.client.get(url,params={'device':OTHER}).status_code,403)
