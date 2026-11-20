import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_inquiries_type" AS ENUM('quote', 'contact');
  CREATE TYPE "public"."enum_inquiries_status" AS ENUM('new', 'read', 'replied', 'archived');
  CREATE TYPE "public"."enum_inquiries_office" AS ENUM('sydney', 'wa', 'hcmc');
  CREATE TABLE "inquiries" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"type" "enum_inquiries_type" NOT NULL,
  	"status" "enum_inquiries_status" DEFAULT 'new' NOT NULL,
  	"name" varchar NOT NULL,
  	"company" varchar,
  	"email" varchar NOT NULL,
  	"phone" varchar,
  	"project_type" varchar,
  	"tonnage" varchar,
  	"site_location" varchar,
  	"office" "enum_inquiries_office",
  	"enquiry_type" varchar,
  	"message" varchar,
  	"source_path" varchar,
  	"consent" boolean DEFAULT true NOT NULL,
  	"submission_id" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "quote_page_steps" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"body" varchar NOT NULL
  );
  
  CREATE TABLE "quote_page_project_types" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL
  );
  
  CREATE TABLE "quote_page_tonnage_options" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL
  );
  
  CREATE TABLE "quote_page" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"hero_eyebrow" varchar NOT NULL,
  	"hero_title" varchar NOT NULL,
  	"hero_lede" varchar NOT NULL,
  	"steps_intro_eyebrow" varchar,
  	"steps_intro_title" varchar NOT NULL,
  	"tool_title" varchar NOT NULL,
  	"tool_body" varchar NOT NULL,
  	"tool_label" varchar NOT NULL,
  	"tool_href" varchar NOT NULL,
  	"fallback_lead" varchar NOT NULL,
  	"fallback_phone_a_u" varchar NOT NULL,
  	"fallback_phone_v_n" varchar NOT NULL,
  	"form_title" varchar NOT NULL,
  	"form_intro" varchar NOT NULL,
  	"form_form_note" varchar NOT NULL,
  	"form_consent_label" varchar NOT NULL,
  	"form_consent_href" varchar NOT NULL,
  	"form_success_heading" varchar NOT NULL,
  	"form_success_body" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "_quote_page_v_version_steps" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"body" varchar NOT NULL,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_quote_page_v_version_project_types" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_quote_page_v_version_tonnage_options" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_quote_page_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version_hero_eyebrow" varchar NOT NULL,
  	"version_hero_title" varchar NOT NULL,
  	"version_hero_lede" varchar NOT NULL,
  	"version_steps_intro_eyebrow" varchar,
  	"version_steps_intro_title" varchar NOT NULL,
  	"version_tool_title" varchar NOT NULL,
  	"version_tool_body" varchar NOT NULL,
  	"version_tool_label" varchar NOT NULL,
  	"version_tool_href" varchar NOT NULL,
  	"version_fallback_lead" varchar NOT NULL,
  	"version_fallback_phone_a_u" varchar NOT NULL,
  	"version_fallback_phone_v_n" varchar NOT NULL,
  	"version_form_title" varchar NOT NULL,
  	"version_form_intro" varchar NOT NULL,
  	"version_form_form_note" varchar NOT NULL,
  	"version_form_consent_label" varchar NOT NULL,
  	"version_form_consent_href" varchar NOT NULL,
  	"version_form_success_heading" varchar NOT NULL,
  	"version_form_success_body" varchar NOT NULL,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "inquiries_id" integer;
  ALTER TABLE "quote_page_steps" ADD CONSTRAINT "quote_page_steps_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."quote_page"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "quote_page_project_types" ADD CONSTRAINT "quote_page_project_types_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."quote_page"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "quote_page_tonnage_options" ADD CONSTRAINT "quote_page_tonnage_options_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."quote_page"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_quote_page_v_version_steps" ADD CONSTRAINT "_quote_page_v_version_steps_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_quote_page_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_quote_page_v_version_project_types" ADD CONSTRAINT "_quote_page_v_version_project_types_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_quote_page_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_quote_page_v_version_tonnage_options" ADD CONSTRAINT "_quote_page_v_version_tonnage_options_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_quote_page_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "inquiries_type_idx" ON "inquiries" USING btree ("type");
  CREATE INDEX "inquiries_status_idx" ON "inquiries" USING btree ("status");
  CREATE UNIQUE INDEX "inquiries_submission_id_idx" ON "inquiries" USING btree ("submission_id");
  CREATE INDEX "inquiries_updated_at_idx" ON "inquiries" USING btree ("updated_at");
  CREATE INDEX "inquiries_created_at_idx" ON "inquiries" USING btree ("created_at");
  CREATE INDEX "quote_page_steps_order_idx" ON "quote_page_steps" USING btree ("_order");
  CREATE INDEX "quote_page_steps_parent_id_idx" ON "quote_page_steps" USING btree ("_parent_id");
  CREATE INDEX "quote_page_project_types_order_idx" ON "quote_page_project_types" USING btree ("_order");
  CREATE INDEX "quote_page_project_types_parent_id_idx" ON "quote_page_project_types" USING btree ("_parent_id");
  CREATE INDEX "quote_page_tonnage_options_order_idx" ON "quote_page_tonnage_options" USING btree ("_order");
  CREATE INDEX "quote_page_tonnage_options_parent_id_idx" ON "quote_page_tonnage_options" USING btree ("_parent_id");
  CREATE INDEX "_quote_page_v_version_steps_order_idx" ON "_quote_page_v_version_steps" USING btree ("_order");
  CREATE INDEX "_quote_page_v_version_steps_parent_id_idx" ON "_quote_page_v_version_steps" USING btree ("_parent_id");
  CREATE INDEX "_quote_page_v_version_project_types_order_idx" ON "_quote_page_v_version_project_types" USING btree ("_order");
  CREATE INDEX "_quote_page_v_version_project_types_parent_id_idx" ON "_quote_page_v_version_project_types" USING btree ("_parent_id");
  CREATE INDEX "_quote_page_v_version_tonnage_options_order_idx" ON "_quote_page_v_version_tonnage_options" USING btree ("_order");
  CREATE INDEX "_quote_page_v_version_tonnage_options_parent_id_idx" ON "_quote_page_v_version_tonnage_options" USING btree ("_parent_id");
  CREATE INDEX "_quote_page_v_created_at_idx" ON "_quote_page_v" USING btree ("created_at");
  CREATE INDEX "_quote_page_v_updated_at_idx" ON "_quote_page_v" USING btree ("updated_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_inquiries_fk" FOREIGN KEY ("inquiries_id") REFERENCES "public"."inquiries"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_inquiries_id_idx" ON "payload_locked_documents_rels" USING btree ("inquiries_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "inquiries" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "quote_page_steps" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "quote_page_project_types" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "quote_page_tonnage_options" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "quote_page" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_quote_page_v_version_steps" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_quote_page_v_version_project_types" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_quote_page_v_version_tonnage_options" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_quote_page_v" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "inquiries" CASCADE;
  DROP TABLE "quote_page_steps" CASCADE;
  DROP TABLE "quote_page_project_types" CASCADE;
  DROP TABLE "quote_page_tonnage_options" CASCADE;
  DROP TABLE "quote_page" CASCADE;
  DROP TABLE "_quote_page_v_version_steps" CASCADE;
  DROP TABLE "_quote_page_v_version_project_types" CASCADE;
  DROP TABLE "_quote_page_v_version_tonnage_options" CASCADE;
  DROP TABLE "_quote_page_v" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_inquiries_fk";
  
  DROP INDEX "payload_locked_documents_rels_inquiries_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "inquiries_id";
  DROP TYPE "public"."enum_inquiries_type";
  DROP TYPE "public"."enum_inquiries_status";
  DROP TYPE "public"."enum_inquiries_office";`)
}
