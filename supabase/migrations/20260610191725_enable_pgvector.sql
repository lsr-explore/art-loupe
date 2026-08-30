-- Enable the pgvector extension for the art-historical retrieval corpus.
--
-- This migration only turns the extension on so it is ready for use; the
-- documents/embeddings tables are designed alongside the ingestion pipeline.
-- Only public-domain and open-access collection material is ever vectorized.
create extension if not exists vector with schema extensions;
