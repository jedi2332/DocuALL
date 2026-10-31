import io
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas
import text_extraction
import server


def pdf(*labels):
    out = io.BytesIO()
    c = canvas.Canvas(out)
    for label in labels:
        if label: c.drawString(50, 700, label)
        c.showPage()
    c.save()
    return out.getvalue()


class TextExtractionTests(unittest.TestCase):
    def test_embedded_text_does_not_need_ocr(self):
        with patch('text_extraction.raster_text') as raster:
            result=text_extraction.extract(pdf('First','Second'))
            self.assertIn('--- Page 1 ---\nFirst',result['text'])
            self.assertIn('--- Page 2 ---\nSecond',result['text'])
            self.assertEqual(result['unread_pages'],[])
            raster.assert_not_called()

    def test_mixed_pdf_extracts_missing_page(self):
        with patch('text_extraction.raster_text',return_value='Scanned words') as raster:
            result=text_extraction.extract(pdf('Typed words',''))
            self.assertIn('Scanned words',result['text'])
            self.assertEqual(raster.call_args.args[1],1)
            self.assertEqual(result['unread_pages'],[])

    def test_failed_ocr_reports_page_without_losing_other_text(self):
        with patch('text_extraction.raster_text',side_effect=RuntimeError('engine missing')):
            result=text_extraction.extract(pdf('Typed words',''))
            self.assertIn('Typed words',result['text'])
            self.assertEqual(result['unread_pages'],[2])

    def test_scan_image_used_when_available(self):
        with patch('text_extraction.raster_text',return_value='Found') as raster:
            text_extraction.extract(pdf(''),lambda index:b'image bytes')
            self.assertEqual(raster.call_args.args[2],b'image bytes')

    def test_raster_page_budget_is_explicit(self):
        with patch.object(text_extraction,'MAX_RASTER_PAGES',1),patch('text_extraction.raster_text',return_value='Found') as raster:
            result=text_extraction.extract(pdf('',''))
            self.assertEqual(raster.call_count,1)
            self.assertEqual(result['unread_pages'],[2])

    def test_text_limit_marks_truncation(self):
        with patch.object(text_extraction,'MAX_CHARS',5):
            result=text_extraction.extract(pdf('Long text','More text'))
            self.assertTrue(result['truncated'])
            self.assertEqual(result['unread_pages'],[2])
            self.assertIn('Long ',result['text'])

    def test_deadline_marks_unprocessed_pages(self):
        with patch('text_extraction.time.monotonic',side_effect=[0,61,61,61,61]),patch('text_extraction.raster_text') as raster:
            result=text_extraction.extract(pdf('First','Second'))
            self.assertEqual(result['unread_pages'],[1,2])
            raster.assert_not_called()

    def test_route_persists_gap_status(self):
        doc=dict(id='doc',owner_id='owner-123',title='Mixed',kind='imported',pdf_path='owner-123/a.pdf',page_count=2,created_at='now',updated_at='now')
        with patch('billing.require_pro'),patch('server._require_doc',return_value=doc),patch('storage.read_file',return_value=pdf('Typed','')),patch('text_extraction.raster_text',side_effect=RuntimeError()),patch('storage.update_document',side_effect=lambda _,fields:{**doc,**fields}) as update,TestClient(server.app) as client:
            response=client.post('/api/documents/doc/ocr',headers={'X-Device-Id':'owner-123'})
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.json()['document']['ocr_unread_pages'],[2])
            self.assertEqual(update.call_args.args[1]['ocr_unread_pages'],[2])

    def test_empty_result_does_not_erase_saved_text(self):
        doc={'pdf_path':'owner-123/a.pdf'}
        with patch('billing.require_pro'),patch('server._require_doc',return_value=doc),patch('storage.read_file',return_value=pdf('')),patch('text_extraction.raster_text',return_value=''),patch('storage.update_document') as update,TestClient(server.app) as client:
            response=client.post('/api/documents/doc/ocr',headers={'X-Device-Id':'owner-123'})
            self.assertEqual(response.status_code,422)
            update.assert_not_called()

    def test_signing_invalidates_saved_extraction(self):
        import asyncio
        doc={'id':'doc','kind':'imported','pdf_path':'old.pdf','page_count':1,'ocr_text':'Old words'}
        with patch('storage.read_file',return_value=pdf('Original')),patch('pdf_utils.composite_fields_on_pdf',return_value=b'new pdf'),patch('storage.save_file',return_value='new.pdf'),patch('storage.update_document',side_effect=lambda _,fields:{**doc,**fields}):
            result=asyncio.run(server._apply_resolved_fields(doc,[], 'owner-123'))
            self.assertIsNone(result['ocr_text'])
            self.assertEqual(result['ocr_unread_pages'],[])
            self.assertFalse(result['ocr_truncated'])
