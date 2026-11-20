import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "site_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"brand_site_name" varchar DEFAULT 'Smart Solutions Australia' NOT NULL,
  	"brand_legal_name" varchar,
  	"brand_tagline" varchar,
  	"brand_logo_id" integer,
  	"contact_email" varchar NOT NULL,
  	"contact_phone_a_u" varchar,
  	"contact_phone_v_n" varchar,
  	"contact_phone_w_a" varchar,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "_site_settings_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version_brand_site_name" varchar DEFAULT 'Smart Solutions Australia' NOT NULL,
  	"version_brand_legal_name" varchar,
  	"version_brand_tagline" varchar,
  	"version_brand_logo_id" integer,
  	"version_contact_email" varchar NOT NULL,
  	"version_contact_phone_a_u" varchar,
  	"version_contact_phone_v_n" varchar,
  	"version_contact_phone_w_a" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "header" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"labels_home" varchar DEFAULT 'Home' NOT NULL,
  	"labels_capabilities" varchar DEFAULT 'Capabilities' NOT NULL,
  	"labels_process" varchar DEFAULT 'Process' NOT NULL,
  	"labels_quality" varchar DEFAULT 'Quality' NOT NULL,
  	"labels_projects" varchar DEFAULT 'Projects' NOT NULL,
  	"labels_products" varchar DEFAULT 'Products' NOT NULL,
  	"labels_team" varchar DEFAULT 'Team' NOT NULL,
  	"labels_contact" varchar DEFAULT 'Contact' NOT NULL,
  	"cta_label" varchar DEFAULT 'Request a Quote' NOT NULL,
  	"cta_href" varchar DEFAULT '/quote' NOT NULL,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "_header_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version_labels_home" varchar DEFAULT 'Home' NOT NULL,
  	"version_labels_capabilities" varchar DEFAULT 'Capabilities' NOT NULL,
  	"version_labels_process" varchar DEFAULT 'Process' NOT NULL,
  	"version_labels_quality" varchar DEFAULT 'Quality' NOT NULL,
  	"version_labels_projects" varchar DEFAULT 'Projects' NOT NULL,
  	"version_labels_products" varchar DEFAULT 'Products' NOT NULL,
  	"version_labels_team" varchar DEFAULT 'Team' NOT NULL,
  	"version_labels_contact" varchar DEFAULT 'Contact' NOT NULL,
  	"version_cta_label" varchar DEFAULT 'Request a Quote' NOT NULL,
  	"version_cta_href" varchar DEFAULT '/quote' NOT NULL,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "footer_compliance" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL,
  	"href" varchar
  );
  
  CREATE TABLE "footer" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"description" varchar,
  	"copyright" varchar,
  	"modern_slavery_text" varchar,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "_footer_v_version_compliance" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL,
  	"href" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_footer_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version_description" varchar,
  	"version_copyright" varchar,
  	"version_modern_slavery_text" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_brand_logo_id_media_id_fk" FOREIGN KEY ("brand_logo_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_site_settings_v" ADD CONSTRAINT "_site_settings_v_version_brand_logo_id_media_id_fk" FOREIGN KEY ("version_brand_logo_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "footer_compliance" ADD CONSTRAINT "footer_compliance_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."footer"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_footer_v_version_compliance" ADD CONSTRAINT "_footer_v_version_compliance_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_footer_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "site_settings_brand_brand_logo_idx" ON "site_settings" USING btree ("brand_logo_id");
  CREATE INDEX "_site_settings_v_version_brand_version_brand_logo_idx" ON "_site_settings_v" USING btree ("version_brand_logo_id");
  CREATE INDEX "_site_settings_v_created_at_idx" ON "_site_settings_v" USING btree ("created_at");
  CREATE INDEX "_site_settings_v_updated_at_idx" ON "_site_settings_v" USING btree ("updated_at");
  CREATE INDEX "_header_v_created_at_idx" ON "_header_v" USING btree ("created_at");
  CREATE INDEX "_header_v_updated_at_idx" ON "_header_v" USING btree ("updated_at");
  CREATE INDEX "footer_compliance_order_idx" ON "footer_compliance" USING btree ("_order");
  CREATE INDEX "footer_compliance_parent_id_idx" ON "footer_compliance" USING btree ("_parent_id");
  CREATE INDEX "_footer_v_version_compliance_order_idx" ON "_footer_v_version_compliance" USING btree ("_order");
  CREATE INDEX "_footer_v_version_compliance_parent_id_idx" ON "_footer_v_version_compliance" USING btree ("_parent_id");
  CREATE INDEX "_footer_v_created_at_idx" ON "_footer_v" USING btree ("created_at");
  CREATE INDEX "_footer_v_updated_at_idx" ON "_footer_v" USING btree ("updated_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "site_settings" CASCADE;
  DROP TABLE "_site_settings_v" CASCADE;
  DROP TABLE "header" CASCADE;
  DROP TABLE "_header_v" CASCADE;
  DROP TABLE "footer_compliance" CASCADE;
  DROP TABLE "footer" CASCADE;
  DROP TABLE "_footer_v_version_compliance" CASCADE;
  DROP TABLE "_footer_v" CASCADE;`)
}
