"""RevenueCat is authoritative; clients never submit entitlement flags or receipt claims."""
import hashlib
import hmac
import os
from datetime import datetime, timezone
from urllib.parse import quote

import requests
from fastapi import HTTPException


def mode():
    value = os.getenv('DOCUALL_BILLING_MODE', 'disabled')
    if value not in {'disabled', 'test', 'play-test', 'live'}:
        raise HTTPException(503, 'Billing configuration is unavailable')
    return value


def customer_id(device_id):
    secret = os.getenv('DOCUALL_BILLING_ID_SECRET', '')
    if len(secret) < 32:
        raise HTTPException(503, 'Billing configuration is unavailable')
    # Do not send the document-access credential to a third-party SDK.
    return 'docuall_' + hmac.new(secret.encode(), device_id.encode(), hashlib.sha256).hexdigest()


def parse_date(value):
    if not isinstance(value, str):
        raise ValueError('Expected subscription expiry')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('Missing timezone')
    return parsed


def evaluate_subscriber(payload, billing_mode, allowed_products, now=None):
    """Subscription-only launch: reject unconfigured products and unverified lifetime grants."""
    now = now or datetime.now(timezone.utc)
    subscriber = payload['subscriber']
    entitlement = subscriber.get('entitlements', {}).get('docuall_pro')
    if not entitlement:
        return {'pro': False, 'expires_at': None}
    product = entitlement.get('product_identifier')
    subscription = subscriber.get('subscriptions', {}).get(product, {})
    if product not in allowed_products or not subscription or subscription.get('refunded_at'):
        return {'pro': False, 'expires_at': None}
    sandbox = subscription.get('is_sandbox')
    if sandbox is not (billing_mode in {'test', 'play-test'}):
        return {'pro': False, 'expires_at': None}
    # A cancellation stops renewal; it does not remove access already paid for.
    expiry = parse_date(entitlement['expires_date'])
    grace = entitlement.get('grace_period_expires_date')
    if grace:
        expiry = max(expiry, parse_date(grace))
    return {'pro': expiry > now, 'expires_at': expiry.isoformat()}


def get_status(device_id):
    billing_mode = mode()
    if billing_mode == 'disabled':
        return {'mode': 'disabled', 'pro': False, 'expires_at': None, 'customer_id': None}
    customer = customer_id(device_id)
    key = os.getenv('REVENUECAT_SECRET_API_KEY', '').strip()
    products = {p.strip() for p in os.getenv('DOCUALL_BILLING_PRODUCT_IDS', '').split(',') if p.strip()}
    if not key or not products:
        raise HTTPException(503, 'Billing configuration is unavailable')
    try:
        response = requests.get('https://api.revenuecat.com/v1/subscribers/' + quote(customer, safe=''),
            headers={'Authorization': 'Bearer ' + key, 'Accept': 'application/json'}, timeout=(3, 8))
        if response.status_code == 404:
            status = {'pro': False, 'expires_at': None}
        else:
            response.raise_for_status()
            status = evaluate_subscriber(response.json(), billing_mode, products)
    except (requests.RequestException, ValueError, KeyError, TypeError, AttributeError):
        # An outage is not "free" and never grants Pro. Preserve an honest retry state.
        raise HTTPException(503, 'Unable to verify purchases right now. Please try again.') from None
    return {'mode': billing_mode, 'customer_id': customer, **status}


def require_pro(device_id):
    status = get_status(device_id)
    if status['mode'] != 'disabled' and not status['pro']:
        raise HTTPException(402, 'DocuALL Pro is required for this feature')
