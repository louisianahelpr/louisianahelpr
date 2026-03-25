CREATE POLICY "Users can delete their own sent messages"
ON public.messages
FOR DELETE
TO authenticated
USING (auth.uid() = sender_id);