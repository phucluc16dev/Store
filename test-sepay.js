require('dotenv').config();
const { SePayPgClient } = require('sepay-pg-node');

const sepayClient = new SePayPgClient({
    env: 'sandbox',
    merchant_id: process.env.SEPAY_MERCHANT_ID || 'YOUR_MERCHANT_ID',
    secret_key: process.env.SEPAY_SECRET_KEY || 'YOUR_SECRET_KEY'
});

const checkoutURL = sepayClient.checkout.initCheckoutUrl();
const checkoutFormfields = sepayClient.checkout.initOneTimePaymentFields({
    payment_method: 'BANK_TRANSFER',
    order_invoice_number: 'DH12345',
    order_amount: 50000,
    currency: 'VND',
    order_description: `NAP 12345`,
    success_url: 'https://www.ai4dev.shop/nap-tien?status=success',
    error_url: 'https://www.ai4dev.shop/nap-tien?status=error',
    cancel_url: 'https://www.ai4dev.shop/nap-tien?status=cancel'
});

console.log('--- URL ---');
console.log(checkoutURL);
console.log('--- FIELDS ---');
console.log(checkoutFormfields);
