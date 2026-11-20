import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "projects_page" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"hero_eyebrow" varchar NOT NULL,
  	"hero_title" varchar NOT NULL,
  	"hero_lede" varchar NOT NULL,
  	"hero_primary_label" varchar NOT NULL,
  	"hero_primary_href" varchar NOT NULL,
  	"hero_secondary_label" varchar NOT NULL,
  	"hero_secondary_href" varchar NOT NULL,
  	"hero_intro_eyebrow" varchar,
  	"hero_intro_title" varchar NOT NULL,
  	"hero_intro_body" varchar,
  	"note_title" varchar NOT NULL,
  	"note_body" varchar NOT NULL,
  	"note_link_label" varchar,
  	"note_link_href" varchar,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "_projects_page_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version_hero_eyebrow" varchar NOT NULL,
  	"version_hero_title" varchar NOT NULL,
  	"version_hero_lede" varchar NOT NULL,
  	"version_hero_primary_label" varchar NOT NULL,
  	"version_hero_primary_href" varchar NOT NULL,
  	"version_hero_secondary_label" varchar NOT NULL,
  	"version_hero_secondary_href" varchar NOT NULL,
  	"version_hero_intro_eyebrow" varchar,
  	"version_hero_intro_title" varchar NOT NULL,
  	"version_hero_intro_body" varchar,
  	"version_note_title" varchar NOT NULL,
  	"version_note_body" varchar NOT NULL,
  	"version_note_link_label" varchar,
  	"version_note_link_href" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE INDEX "_projects_page_v_created_at_idx" ON "_projects_page_v" USING btree ("created_at");
  CREATE INDEX "_projects_page_v_updated_at_idx" ON "_projects_page_v" USING btree ("updated_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "projects_page" CASCADE;
  DROP TABLE "_projects_page_v" CASCADE;`)
}
