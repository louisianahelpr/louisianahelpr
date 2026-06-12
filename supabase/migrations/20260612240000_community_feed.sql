CREATE TABLE IF NOT EXISTS community_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_type text NOT NULL CHECK (post_type IN (
    'before_after',     -- completed job with before/after photos
    'spotlight',        -- admin-curated helper spotlight
    'milestone',        -- auto-generated: 10th job, 5-star streak, etc.
    'tip'               -- quick local knowledge tip
  )),
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  title text,
  body text,
  before_photo_url text,
  after_photo_url text,
  photos text[] DEFAULT '{}',
  category text,
  parish text,
  is_approved boolean NOT NULL DEFAULT false,
  like_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS community_post_likes (
  post_id uuid NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);

-- RLS
ALTER TABLE community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_post_likes ENABLE ROW LEVEL SECURITY;

-- Approved posts are public (or the author can always see their own)
CREATE POLICY "Approved posts are public" ON community_posts
  FOR SELECT USING (is_approved = true OR author_id = auth.uid());

-- Authors can insert their own
CREATE POLICY "Authors can create posts" ON community_posts
  FOR INSERT WITH CHECK (auth.uid() = author_id);

-- Authors can update their own posts
CREATE POLICY "Authors manage own posts" ON community_posts
  FOR UPDATE USING (auth.uid() = author_id);

-- Authors can delete their own posts
CREATE POLICY "Authors delete own posts" ON community_posts
  FOR DELETE USING (auth.uid() = author_id);

CREATE POLICY "Likes are public" ON community_post_likes FOR SELECT USING (true);
CREATE POLICY "Users manage own likes" ON community_post_likes
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS community_posts_created_at_idx ON community_posts(created_at DESC)
  WHERE is_approved = true;
CREATE INDEX IF NOT EXISTS community_posts_parish_idx ON community_posts(parish, created_at DESC)
  WHERE is_approved = true;
CREATE INDEX IF NOT EXISTS community_posts_author_idx ON community_posts(author_id);

-- Auto-approve milestone posts (system-generated, always safe)
CREATE OR REPLACE FUNCTION auto_approve_milestone()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.post_type = 'milestone' THEN
    NEW.is_approved := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_approve_milestone_trigger ON community_posts;
CREATE TRIGGER auto_approve_milestone_trigger
  BEFORE INSERT ON community_posts
  FOR EACH ROW EXECUTE FUNCTION auto_approve_milestone();
