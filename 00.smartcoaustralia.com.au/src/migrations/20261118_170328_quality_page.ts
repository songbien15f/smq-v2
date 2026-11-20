import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "quality_page_qa_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"description" varchar NOT NULL
  );
  
  CREATE TABLE "quality_page" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"hero_eyebrow" varchar NOT NULL,
  	"hero_title" varchar NOT NULL,
  	"hero_lede" varchar NOT NULL,
  	"image_id" integer,
  	"image_caption" varchar,
  	"intro_eyebrow" varchar,
  	"intro_title" varchar NOT NULL,
  	"intro_body" varchar,
  	"management_systems_title" varchar NOT NULL,
  	"management_systems_body" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "_quality_page_v_version_qa_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"description" varchar NOT NULL,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_quality_page_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version_hero_eyebrow" varchar NOT NULL,
  	"version_hero_title" varchar NOT NULL,
  	"version_hero_lede" varchar NOT NULL,
  	"version_image_id" integer,
  	"version_image_caption" varchar,
  	"version_intro_eyebrow" varchar,
  	"version_intro_title" varchar NOT NULL,
  	"version_intro_body" varchar,
  	"version_management_systems_title" varchar NOT NULL,
  	"version_management_systems_body" varchar NOT NULL,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "quality_page_qa_items" ADD CONSTRAINT "quality_page_qa_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."quality_page"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "quality_page" ADD CONSTRAINT "quality_page_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_quality_page_v_version_qa_items" ADD CONSTRAINT "_quality_page_v_version_qa_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_quality_page_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_quality_page_v" ADD CONSTRAINT "_quality_page_v_version_image_id_media_id_fk" FOREIGN KEY ("version_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "quality_page_qa_items_order_idx" ON "quality_page_qa_items" USING btree ("_order");
  CREATE INDEX "quality_page_qa_items_parent_id_idx" ON "quality_page_qa_items" USING btree ("_parent_id");
  CREATE INDEX "quality_page_image_idx" ON "quality_page" USING btree ("image_id");
  CREATE INDEX "_quality_page_v_version_qa_items_order_idx" ON "_quality_page_v_version_qa_items" USING btree ("_order");
  CREATE INDEX "_quality_page_v_version_qa_items_parent_id_idx" ON "_quality_page_v_version_qa_items" USING btree ("_parent_id");
  CREATE INDEX "_quality_page_v_version_version_image_idx" ON "_quality_page_v" USING btree ("version_image_id");
  CREATE INDEX "_quality_page_v_created_at_idx" ON "_quality_page_v" USING btree ("created_at");
  CREATE INDEX "_quality_page_v_updated_at_idx" ON "_quality_page_v" USING btree ("updated_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "quality_page_qa_items" CASCADE;
  DROP TABLE "quality_page" CASCADE;
  DROP TABLE "_quality_page_v_version_qa_items" CASCADE;
  DROP TABLE "_quality_page_v" CASCADE;`)
}
