import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "process_page_steps" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"body" varchar NOT NULL
  );
  
  CREATE TABLE "process_page" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"hero_eyebrow" varchar NOT NULL,
  	"hero_title" varchar NOT NULL,
  	"hero_lede" varchar NOT NULL,
  	"intro_eyebrow" varchar,
  	"intro_title" varchar NOT NULL,
  	"intro_body" varchar,
  	"cta_primary_label" varchar NOT NULL,
  	"cta_primary_href" varchar NOT NULL,
  	"cta_secondary_label" varchar NOT NULL,
  	"cta_secondary_href" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "_process_page_v_version_steps" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"body" varchar NOT NULL,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_process_page_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version_hero_eyebrow" varchar NOT NULL,
  	"version_hero_title" varchar NOT NULL,
  	"version_hero_lede" varchar NOT NULL,
  	"version_intro_eyebrow" varchar,
  	"version_intro_title" varchar NOT NULL,
  	"version_intro_body" varchar,
  	"version_cta_primary_label" varchar NOT NULL,
  	"version_cta_primary_href" varchar NOT NULL,
  	"version_cta_secondary_label" varchar NOT NULL,
  	"version_cta_secondary_href" varchar NOT NULL,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "process_page_steps" ADD CONSTRAINT "process_page_steps_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."process_page"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_process_page_v_version_steps" ADD CONSTRAINT "_process_page_v_version_steps_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_process_page_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "process_page_steps_order_idx" ON "process_page_steps" USING btree ("_order");
  CREATE INDEX "process_page_steps_parent_id_idx" ON "process_page_steps" USING btree ("_parent_id");
  CREATE INDEX "_process_page_v_version_steps_order_idx" ON "_process_page_v_version_steps" USING btree ("_order");
  CREATE INDEX "_process_page_v_version_steps_parent_id_idx" ON "_process_page_v_version_steps" USING btree ("_parent_id");
  CREATE INDEX "_process_page_v_created_at_idx" ON "_process_page_v" USING btree ("created_at");
  CREATE INDEX "_process_page_v_updated_at_idx" ON "_process_page_v" USING btree ("updated_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "process_page_steps" CASCADE;
  DROP TABLE "process_page" CASCADE;
  DROP TABLE "_process_page_v_version_steps" CASCADE;
  DROP TABLE "_process_page_v" CASCADE;`)
}
