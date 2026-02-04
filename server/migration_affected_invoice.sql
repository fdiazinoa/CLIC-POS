-- Migration to add missing columns to transactions table
ALTER TABLE transactions ADD COLUMN affectedInvoiceNumber TEXT;
ALTER TABLE transactions ADD COLUMN affectedNCF TEXT;
