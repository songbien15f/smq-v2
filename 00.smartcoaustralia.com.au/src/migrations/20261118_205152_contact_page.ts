import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "contact_page_quick_links" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL,
  	"value" varchar NOT NULL,
  	"href" varchar NOT NULL,
  	"body" varchar
  );
  
  CREATE TABLE "contact_page_whats_next" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"body" varchar NOT NULL
  );
  
  CREATE TABLE "contact_page_enquiry_types" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL
  );
  
  CREATE TABLE "contact_page" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"hero_eyebrow" varchar NOT NULL,
  	"hero_title" varchar NOT NULL,
  	"hero_lede" varchar NOT NULL,
  	"intro_eyebrow" varchar,
  	"intro_title" varchar NOT NULL,
  	"intro_body" varchar,
  	"intro_link_label" varchar,
  	"intro_link_href" varchar,
  	"whats_next_intro_eyebrow" varchar,
  	"whats_next_intro_title" varchar NOT NULL,
  	"quote_prompt_title" varchar,
  	"quote_prompt_body" varchar,
  	"quote_prompt_label" varchar,
  	"quote_prompt_href" varchar,
  	"form_title" varchar NOT NULL,
  	"form_intro" varchar NOT NULL,
  	"form_note" varchar NOT NULL,
  	"consent_label" varchar NOT NULL,
  	"consent_href" varchar NOT NULL,
  	"success_heading" varchar NOT NULL,
  	"success_body" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "_contact_page_v_version_quick_links" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL,
  	"value" varchar NOT NULL,
  	"href" varchar NOT NULL,
  	"body" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_contact_page_v_version_whats_next" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"body" varchar NOT NULL,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_contact_page_v_version_enquiry_types" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_contact_page_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version_hero_eyebrow" varchar NOT NULL,
  	"version_hero_title" varchar NOT NULL,
  	"version_hero_lede" varchar NOT NULL,
  	"version_intro_eyebrow" varchar,
  	"version_intro_title" varchar NOT NULL,
  	"version_intro_body" varchar,
  	"version_intro_link_label" varchar,
  	"version_intro_link_href" varchar,
  	"version_whats_next_intro_eyebrow" varchar,
  	"version_whats_next_intro_title" varchar NOT NULL,
  	"version_quote_prompt_title" varchar,
  	"version_quote_prompt_body" varchar,
  	"version_quote_prompt_label" varchar,
  	"version_quote_prompt_href" varchar,
  	"version_form_title" varchar NOT NULL,
  	"version_form_intro" varchar NOT NULL,
  	"version_form_note" varchar NOT NULL,
  	"version_consent_label" varchar NOT NULL,
  	"version_consent_href" varchar NOT NULL,
  	"version_success_heading" varchar NOT NULL,
  	"version_success_body" varchar NOT NULL,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "contact_page_quick_links" ADD CONSTRAINT "contact_page_quick_links_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."contact_page"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "contact_page_whats_next" ADD CONSTRAINT "contact_page_whats_next_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."contact_page"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "contact_page_enquiry_types" ADD CONSTRAINT "contact_page_enquiry_types_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."contact_page"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_contact_page_v_version_quick_links" ADD CONSTRAINT "_contact_page_v_version_quick_links_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_contact_page_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_contact_page_v_version_whats_next" ADD CONSTRAINT "_contact_page_v_version_whats_next_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_contact_page_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_contact_page_v_version_enquiry_types" ADD CONSTRAINT "_contact_page_v_version_enquiry_types_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_contact_page_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "contact_page_quick_links_order_idx" ON "contact_page_quick_links" USING btree ("_order");
  CREATE INDEX "contact_page_quick_links_parent_id_idx" ON "contact_page_quick_links" USING btree ("_parent_id");
  CREATE INDEX "contact_page_whats_next_order_idx" ON "contact_page_whats_next" USING btree ("_order");
  CREATE INDEX "contact_page_whats_next_parent_id_idx" ON "contact_page_whats_next" USING btree ("_parent_id");
  CREATE INDEX "contact_page_enquiry_types_order_idx" ON "contact_page_enquiry_types" USING btree ("_order");
  CREATE INDEX "contact_page_enquiry_types_parent_id_idx" ON "contact_page_enquiry_types" USING btree ("_parent_id");
  CREATE INDEX "_contact_page_v_version_quick_links_order_idx" ON "_contact_page_v_version_quick_links" USING btree ("_order");
  CREATE INDEX "_contact_page_v_version_quick_links_parent_id_idx" ON "_contact_page_v_version_quick_links" USING btree ("_parent_id");
  CREATE INDEX "_contact_page_v_version_whats_next_order_idx" ON "_contact_page_v_version_whats_next" USING btree ("_order");
  CREATE INDEX "_contact_page_v_version_whats_next_parent_id_idx" ON "_contact_page_v_version_whats_next" USING btree ("_parent_id");
  CREATE INDEX "_contact_page_v_version_enquiry_types_order_idx" ON "_contact_page_v_version_enquiry_types" USING btree ("_order");
  CREATE INDEX "_contact_page_v_version_enquiry_types_parent_id_idx" ON "_contact_page_v_version_enquiry_types" USING btree ("_parent_id");
  CREATE INDEX "_contact_page_v_created_at_idx" ON "_contact_page_v" USING btree ("created_at");
  CREATE INDEX "_contact_page_v_updated_at_idx" ON "_contact_page_v" USING btree ("updated_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "contact_page_quick_links" CASCADE;
  DROP TABLE "contact_page_whats_next" CASCADE;
  DROP TABLE "contact_page_enquiry_types" CASCADE;
  DROP TABLE "contact_page" CASCADE;
  DROP TABLE "_contact_page_v_version_quick_links" CASCADE;
  DROP TABLE "_contact_page_v_version_whats_next" CASCADE;
  DROP TABLE "_contact_page_v_version_enquiry_types" CASCADE;
  DROP TABLE "_contact_page_v" CASCADE;`)
}
