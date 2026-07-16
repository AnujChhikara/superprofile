-- Custom SQL migration file, put your code below! --
ALTER TABLE kb_articles DROP COLUMN IF EXISTS search_vector;
ALTER TABLE kb_articles ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || body_text)) STORED;
CREATE INDEX art_fts ON kb_articles USING GIN (search_vector);
