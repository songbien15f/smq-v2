import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "team_page" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"hero_eyebrow" varchar NOT NULL,
  	"hero_title" varchar NOT NULL,
  	"hero_lede" varchar NOT NULL,
  	"hero_primary_label" varchar NOT NULL,
  	"hero_primary_href" varchar NOT NULL,
  	"intro_eyebrow" varchar,
  	"intro_title" varchar NOT NULL,
  	"intro_body" varchar,
  	"quote_text" varchar NOT NULL,
  	"quote_attribution" varchar,
  	"quote_image_id" integer,
  	"quote_image_alt" varchar,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "_team_page_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version_hero_eyebrow" varchar NOT NULL,
  	"version_hero_title" varchar NOT NULL,
  	"version_hero_lede" varchar NOT NULL,
  	"version_hero_primary_label" varchar NOT NULL,
  	"version_hero_primary_href" varchar NOT NULL,
  	"version_intro_eyebrow" varchar,
  	"version_intro_title" varchar NOT NULL,
  	"version_intro_body" varchar,
  	"version_quote_text" varchar NOT NULL,
  	"version_quote_attribution" varchar,
  	"version_quote_image_id" integer,
  	"version_quote_image_alt" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "team_page" ADD CONSTRAINT "team_page_quote_image_id_media_id_fk" FOREIGN KEY ("quote_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_team_page_v" ADD CONSTRAINT "_team_page_v_version_quote_image_id_media_id_fk" FOREIGN KEY ("version_quote_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "team_page_quote_quote_image_idx" ON "team_page" USING btree ("quote_image_id");
  CREATE INDEX "_team_page_v_version_quote_version_quote_image_idx" ON "_team_page_v" USING btree ("version_quote_image_id");
  CREATE INDEX "_team_page_v_created_at_idx" ON "_team_page_v" USING btree ("created_at");
  CREATE INDEX "_team_page_v_updated_at_idx" ON "_team_page_v" USING btree ("updated_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "team_page" CASCADE;
  DROP TABLE "_team_page_v" CASCADE;`)
}
