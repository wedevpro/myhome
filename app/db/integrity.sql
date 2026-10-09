-- JSON references are checked atomically by SQLite to prevent cross-household
-- references, missing parents and category cycles during concurrent writes.
CREATE TRIGGER records_insert_guard BEFORE INSERT ON records BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM memberships WHERE household_id=NEW.household_id AND user_id=NEW.updated_by AND status='active' AND (NEW.kind NOT IN ('electricity','waste') OR role='admin')) THEN RAISE(ABORT,'MYHOME_REFERENCE access') END;
 SELECT CASE WHEN json_extract(NEW.data,'$.listId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM records WHERE id=json_extract(NEW.data,'$.listId') AND household_id=NEW.household_id AND kind IN ('shopping','checklist')) THEN RAISE(ABORT,'MYHOME_REFERENCE list') END;
 SELECT CASE WHEN json_extract(NEW.data,'$.productId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM records WHERE id=json_extract(NEW.data,'$.productId') AND household_id=NEW.household_id AND kind='product') THEN RAISE(ABORT,'MYHOME_REFERENCE product') END;
 SELECT CASE WHEN json_extract(NEW.data,'$.categoryId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM records WHERE id=json_extract(NEW.data,'$.categoryId') AND household_id=NEW.household_id AND kind='category') THEN RAISE(ABORT,'MYHOME_REFERENCE category') END;
 SELECT CASE WHEN json_extract(NEW.data,'$.parentId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM records WHERE id=json_extract(NEW.data,'$.parentId') AND household_id=NEW.household_id AND kind='category') THEN RAISE(ABORT,'MYHOME_REFERENCE parent') END;
END;
--> statement-breakpoint
CREATE TRIGGER records_update_guard BEFORE UPDATE ON records BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM memberships WHERE household_id=NEW.household_id AND user_id=NEW.updated_by AND status='active' AND (NEW.kind NOT IN ('electricity','waste') OR role='admin')) THEN RAISE(ABORT,'MYHOME_REFERENCE access') END;
 SELECT CASE WHEN NEW.household_id!=OLD.household_id OR NEW.kind!=OLD.kind OR NEW.id!=OLD.id THEN RAISE(ABORT,'MYHOME_REFERENCE immutable') END;
 SELECT CASE WHEN json_extract(NEW.data,'$.listId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM records WHERE id=json_extract(NEW.data,'$.listId') AND household_id=NEW.household_id AND kind IN ('shopping','checklist')) THEN RAISE(ABORT,'MYHOME_REFERENCE list') END;
 SELECT CASE WHEN json_extract(NEW.data,'$.productId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM records WHERE id=json_extract(NEW.data,'$.productId') AND household_id=NEW.household_id AND kind='product') THEN RAISE(ABORT,'MYHOME_REFERENCE product') END;
 SELECT CASE WHEN json_extract(NEW.data,'$.categoryId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM records WHERE id=json_extract(NEW.data,'$.categoryId') AND household_id=NEW.household_id AND kind='category') THEN RAISE(ABORT,'MYHOME_REFERENCE category') END;
 SELECT CASE WHEN json_extract(NEW.data,'$.parentId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM records WHERE id=json_extract(NEW.data,'$.parentId') AND household_id=NEW.household_id AND kind='category') THEN RAISE(ABORT,'MYHOME_REFERENCE parent') END;
 SELECT CASE WHEN NEW.kind='category' AND EXISTS(WITH RECURSIVE ancestors(id) AS (SELECT json_extract(NEW.data,'$.parentId') UNION SELECT json_extract(r.data,'$.parentId') FROM records r JOIN ancestors a ON r.id=a.id WHERE r.household_id=NEW.household_id AND json_extract(r.data,'$.parentId') IS NOT NULL) SELECT 1 FROM ancestors WHERE id=NEW.id) THEN RAISE(ABORT,'MYHOME_CYCLE') END;
END;
--> statement-breakpoint
CREATE TRIGGER records_delete_guard BEFORE DELETE ON records BEGIN
 SELECT CASE WHEN OLD.kind IN ('shopping','checklist') AND EXISTS(SELECT 1 FROM records WHERE household_id=OLD.household_id AND json_extract(data,'$.listId')=OLD.id) THEN RAISE(ABORT,'MYHOME_REFERENCE list_children') END;
 SELECT CASE WHEN OLD.kind='category' AND EXISTS(SELECT 1 FROM records WHERE household_id=OLD.household_id AND (json_extract(data,'$.parentId')=OLD.id OR json_extract(data,'$.categoryId')=OLD.id)) THEN RAISE(ABORT,'MYHOME_REFERENCE category_children') END;
 SELECT CASE WHEN OLD.kind='product' AND EXISTS(SELECT 1 FROM records WHERE household_id=OLD.household_id AND json_extract(data,'$.productId')=OLD.id) THEN RAISE(ABORT,'MYHOME_REFERENCE product_children') END;
END;
--> statement-breakpoint
CREATE TRIGGER barcodes_insert_guard BEFORE INSERT ON barcodes BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM records WHERE id=NEW.product_id AND household_id=NEW.household_id AND kind='product') THEN RAISE(ABORT,'MYHOME_REFERENCE barcode_product') END;
END;
--> statement-breakpoint
CREATE TRIGGER memberships_update_guard BEFORE UPDATE ON memberships BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM memberships WHERE household_id=NEW.household_id AND user_id=NEW.updated_by AND status='active' AND role='admin') THEN RAISE(ABORT,'MYHOME_REFERENCE admin') END;
END;
--> statement-breakpoint
CREATE TRIGGER households_update_guard BEFORE UPDATE ON households BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM memberships WHERE household_id=NEW.id AND user_id=NEW.updated_by AND status='active' AND role='admin') THEN RAISE(ABORT,'MYHOME_REFERENCE admin') END;
END;
