import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "capabilities_page_capabilities_features" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"text" varchar NOT NULL
  );
  
  CREATE TABLE "capabilities_page_capabilities" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"body" varchar NOT NULL,
  	"image_id" integer
  );
  
  CREATE TABLE "capabilities_page" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"hero_eyebrow" varchar NOT NULL,
  	"hero_title" varchar NOT NULL,
  	"hero_lede" varchar NOT NULL,
  	"intro_eyebrow" varchar,
  	"intro_title" varchar NOT NULL,
  	"intro_body" varchar,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "_capabilities_page_v_version_capabilities_features" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"text" varchar NOT NULL,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_capabilities_page_v_version_capabilities" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"body" varchar NOT NULL,
  	"image_id" integer,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_capabilities_page_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version_hero_eyebrow" varchar NOT NULL,
  	"version_hero_title" varchar NOT NULL,
  	"version_hero_lede" varchar NOT NULL,
  	"version_intro_eyebrow" varchar,
  	"version_intro_title" varchar NOT NULL,
  	"version_intro_body" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "capabilities_page_capabilities_features" ADD CONSTRAINT "capabilities_page_capabilities_features_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."capabilities_page_capabilities"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "capabilities_page_capabilities" ADD CONSTRAINT "capabilities_page_capabilities_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "capabilities_page_capabilities" ADD CONSTRAINT "capabilities_page_capabilities_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."capabilities_page"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_capabilities_page_v_version_capabilities_features" ADD CONSTRAINT "_capabilities_page_v_version_capabilities_features_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_capabilities_page_v_version_capabilities"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_capabilities_page_v_version_capabilities" ADD CONSTRAINT "_capabilities_page_v_version_capabilities_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_capabilities_page_v_version_capabilities" ADD CONSTRAINT "_capabilities_page_v_version_capabilities_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_capabilities_page_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "capabilities_page_capabilities_features_order_idx" ON "capabilities_page_capabilities_features" USING btree ("_order");
  CREATE INDEX "capabilities_page_capabilities_features_parent_id_idx" ON "capabilities_page_capabilities_features" USING btree ("_parent_id");
  CREATE INDEX "capabilities_page_capabilities_order_idx" ON "capabilities_page_capabilities" USING btree ("_order");
  CREATE INDEX "capabilities_page_capabilities_parent_id_idx" ON "capabilities_page_capabilities" USING btree ("_parent_id");
  CREATE INDEX "capabilities_page_capabilities_image_idx" ON "capabilities_page_capabilities" USING btree ("image_id");
  CREATE INDEX "_capabilities_page_v_version_capabilities_features_order_idx" ON "_capabilities_page_v_version_capabilities_features" USING btree ("_order");
  CREATE INDEX "_capabilities_page_v_version_capabilities_features_parent_id_idx" ON "_capabilities_page_v_version_capabilities_features" USING btree ("_parent_id");
  CREATE INDEX "_capabilities_page_v_version_capabilities_order_idx" ON "_capabilities_page_v_version_capabilities" USING btree ("_order");
  CREATE INDEX "_capabilities_page_v_version_capabilities_parent_id_idx" ON "_capabilities_page_v_version_capabilities" USING btree ("_parent_id");
  CREATE INDEX "_capabilities_page_v_version_capabilities_image_idx" ON "_capabilities_page_v_version_capabilities" USING btree ("image_id");
  CREATE INDEX "_capabilities_page_v_created_at_idx" ON "_capabilities_page_v" USING btree ("created_at");
  CREATE INDEX "_capabilities_page_v_updated_at_idx" ON "_capabilities_page_v" USING btree ("updated_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "capabilities_page_capabilities_features" CASCADE;
  DROP TABLE "capabilities_page_capabilities" CASCADE;
  DROP TABLE "capabilities_page" CASCADE;
  DROP TABLE "_capabilities_page_v_version_capabilities_features" CASCADE;
  DROP TABLE "_capabilities_page_v_version_capabilities" CASCADE;
  DROP TABLE "_capabilities_page_v" CASCADE;`)
}
