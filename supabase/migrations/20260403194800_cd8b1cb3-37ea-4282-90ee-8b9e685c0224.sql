
-- Make proof-photos bucket private
UPDATE storage.buckets SET public = false WHERE id = 'proof-photos';
