import os
import unittest
from datetime import datetime, timezone
from unittest.mock import patch, Mock
import requests
from fastapi import HTTPException
from fastapi.testclient import TestClient
import billing
import server

NOW = datetime(2026, 10, 31, tzinfo=timezone.utc)
PRODUCT = 'docuall_pro_monthly'

def customer(expiry='2026-12-01T00:00:00Z', sandbox=False, **overrides):
    sub = dict(is_sandbox=sandbox, refunded_at=None, unsubscribe_detected_at=None)
    sub.update(overrides)
    return {'subscriber': {'entitlements': {'docuall_pro': {'product_identifier': PRODUCT, 'expires_date': expiry}}, 'subscriptions': {PRODUCT: sub}}}

class BillingTests(unittest.TestCase):
    def test_active_subscription(self):
        self.assertTrue(billing.evaluate_subscriber(customer(), 'live', {PRODUCT}, NOW)['pro'])

    def test_cancelled_subscription_keeps_paid_period(self):
        self.assertTrue(billing.evaluate_subscriber(customer(unsubscribe_detected_at='2026-10-30T00:00:00Z'), 'live', {PRODUCT}, NOW)['pro'])

    def test_expired_refunded_sandbox_and_unknown_products_denied(self):
        for payload, products in [(customer('2026-10-01T00:00:00Z'), {PRODUCT}),
                                  (customer(refunded_at='2026-10-30T00:00:00Z'), {PRODUCT}),
                                  (customer(sandbox=True), {PRODUCT}), (customer(), {'other'})]:
            with self.subTest(payload=payload):
                self.assertFalse(billing.evaluate_subscriber(payload, 'live', products, NOW)['pro'])

    def test_test_mode_only_accepts_sandbox(self):
        self.assertTrue(billing.evaluate_subscriber(customer(sandbox=True), 'test', {PRODUCT}, NOW)['pro'])
        self.assertFalse(billing.evaluate_subscriber(customer(), 'test', {PRODUCT}, NOW)['pro'])

    def test_play_staging_accepts_only_license_test_purchases(self):
        self.assertTrue(billing.evaluate_subscriber(customer(sandbox=True), 'play-test', {PRODUCT}, NOW)['pro'])
        self.assertFalse(billing.evaluate_subscriber(customer(), 'play-test', {PRODUCT}, NOW)['pro'])

    def test_grace_period(self):
        payload=customer('2026-10-30T00:00:00Z')
        payload['subscriber']['entitlements']['docuall_pro']['grace_period_expires_date']='2026-11-03T00:00:00Z'
        self.assertTrue(billing.evaluate_subscriber(payload, 'live', {PRODUCT}, NOW)['pro'])

    def test_missing_entitlement_is_free(self):
        self.assertFalse(billing.evaluate_subscriber({'subscriber': {}}, 'live', {PRODUCT}, NOW)['pro'])

    def test_lifetime_or_malformed_expiry_not_accepted(self):
        for value in [None, 'invalid', '2026-12-01']:
            with self.assertRaises(ValueError): billing.evaluate_subscriber(customer(value), 'live', {PRODUCT}, NOW)

    def test_identity_is_stable_and_not_document_credential(self):
        with patch.dict(os.environ, {'DOCUALL_BILLING_ID_SECRET':'x'*32}):
            a=billing.customer_id('device-secret')
            self.assertEqual(a,billing.customer_id('device-secret'))
            self.assertNotEqual(a,billing.customer_id('another-device'))
            self.assertNotIn('device-secret',a)

    def test_disabled_mode_never_calls_provider(self):
        with patch.dict(os.environ, {'DOCUALL_BILLING_MODE':'disabled'}), patch('billing.requests.get') as get:
            billing.require_pro('device-secret')
            self.assertEqual(billing.get_status('device-secret')['mode'],'disabled')
            get.assert_not_called()

    def test_provider_failure_never_grants_access(self):
        env={'DOCUALL_BILLING_MODE':'live','DOCUALL_BILLING_ID_SECRET':'x'*32,'REVENUECAT_SECRET_API_KEY':'server-secret','DOCUALL_BILLING_PRODUCT_IDS':PRODUCT}
        with patch.dict(os.environ,env),patch('billing.requests.get',side_effect=requests.Timeout):
            with self.assertRaises(HTTPException) as error: billing.require_pro('device-secret')
            self.assertEqual(error.exception.status_code,503)

    def test_pro_gate_cannot_be_bypassed_with_client_header(self):
        with patch('billing.get_status',return_value={'mode':'live','pro':False}),TestClient(server.app) as client:
            response=client.post('/api/documents/anything/ocr',headers={'X-Device-Id':'owner-123','X-Pro':'true'})
            self.assertEqual(response.status_code,402)

    def test_missing_credentials_fail_closed(self):
        with patch.dict(os.environ, {'DOCUALL_BILLING_MODE':'live','DOCUALL_BILLING_ID_SECRET':''}):
            with self.assertRaises(HTTPException) as error: billing.get_status('owner-123')
            self.assertEqual(error.exception.status_code,503)
