CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  messages JSONB[] DEFAULT '{}'
);


ALTER TABLE rooms REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime
ADD TABLE rooms;

CREATE POLICY "Allow authenticated uploads" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (bucket_id = 'chat-files');

CREATE POLICY "Allow authenticated uploads to chat-files" ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'chat-files');

DROP POLICY IF EXISTS "Allow authenticated uploads to chat-files" ON storage.objects;
DROP POLICY IF EXISTS "Allow public uploads to chat-files" ON storage.objects;


CREATE POLICY "Allow all uploads to chat-files" ON storage.objects
FOR INSERT
TO public
WITH CHECK (bucket_id = 'chat-files');