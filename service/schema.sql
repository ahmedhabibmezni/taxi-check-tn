CREATE SCHEMA card_service;
REVOKE ALL ON SCHEMA card_service FROM PUBLIC;
CREATE TABLE card_service.authority (
  namespace uuid PRIMARY KEY,
  authority_id uuid NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version = 1),
  day bigint NOT NULL DEFAULT 0,
  month integer NOT NULL DEFAULT 0,
  issues integer NOT NULL DEFAULT 0 CHECK (issues >= 0),
  bytes bigint NOT NULL DEFAULT 0 CHECK (bytes >= 0)
);
CREATE TABLE card_service.cards (
  namespace uuid NOT NULL REFERENCES card_service.authority(namespace),
  view_hash text NOT NULL CHECK (view_hash ~ '^[a-f0-9]{64}$'),
  protocol smallint NOT NULL CHECK (protocol = 2),
  status text NOT NULL CHECK (status IN ('issued','active','revoked','expired')),
  expires_at bigint NOT NULL,
  create_until bigint NOT NULL CHECK (create_until <= expires_at),
  revoke_hash text NOT NULL CHECK (revoke_hash ~ '^[a-f0-9]{64}$'),
  creation_hash text NOT NULL CHECK (creation_hash ~ '^[a-f0-9]{64}$'),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  png bytea,
  presentation text,
  width integer,
  height integer,
  PRIMARY KEY (namespace, view_hash),
  CHECK ((status = 'active' AND png IS NOT NULL AND presentation IS NOT NULL AND width = 1200 AND height BETWEEN 800 AND 10000)
    OR (status <> 'active' AND png IS NULL AND presentation IS NULL AND width IS NULL AND height IS NULL))
);
