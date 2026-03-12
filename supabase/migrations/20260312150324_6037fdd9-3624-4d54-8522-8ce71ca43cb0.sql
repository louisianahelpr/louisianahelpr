INSERT INTO storage.buckets (id, name, public)
VALUES 
  ('job-photos', 'job-photos', true),
  ('id-documents', 'id-documents', false),
  ('user-documents', 'user-documents', true),
  ('proof-photos', 'proof-photos', true)
ON CONFLICT (id) DO NOTHING;