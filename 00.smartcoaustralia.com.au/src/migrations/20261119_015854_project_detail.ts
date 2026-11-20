import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "project_detail_settings_stages" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"text" varchar NOT NULL,
  	"image_id" integer
  );
  
  CREATE TABLE "project_detail_settings_qa_docs" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL
  );
  
  CREATE TABLE "project_detail_settings_facts" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL,
  	"value" varchar NOT NULL
  );
  
  CREATE TABLE "project_detail_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"stages_intro" varchar,
  	"qa_intro" varchar,
  	"price_cta" varchar DEFAULT 'Price a Similar Project',
  	"contact_prompt_lead" varchar,
  	"contact_prompt_label" varchar,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "_project_detail_settings_v_version_stages" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"text" varchar NOT NULL,
  	"image_id" integer,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_project_detail_settings_v_version_qa_docs" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_project_detail_settings_v_version_facts" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL,
  	"value" varchar NOT NULL,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_project_detail_settings_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version_stages_intro" varchar,
  	"version_qa_intro" varchar,
  	"version_price_cta" varchar DEFAULT 'Price a Similar Project',
  	"version_contact_prompt_lead" varchar,
  	"version_contact_prompt_label" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "project_detail_settings_stages" ADD CONSTRAINT "project_detail_settings_stages_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "project_detail_settings_stages" ADD CONSTRAINT "project_detail_settings_stages_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."project_detail_settings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "project_detail_settings_qa_docs" ADD CONSTRAINT "project_detail_settings_qa_docs_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."project_detail_settings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "project_detail_settings_facts" ADD CONSTRAINT "project_detail_settings_facts_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."project_detail_settings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_project_detail_settings_v_version_stages" ADD CONSTRAINT "_project_detail_settings_v_version_stages_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_project_detail_settings_v_version_stages" ADD CONSTRAINT "_project_detail_settings_v_version_stages_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_project_detail_settings_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_project_detail_settings_v_version_qa_docs" ADD CONSTRAINT "_project_detail_settings_v_version_qa_docs_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_project_detail_settings_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_project_detail_settings_v_version_facts" ADD CONSTRAINT "_project_detail_settings_v_version_facts_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_project_detail_settings_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "project_detail_settings_stages_order_idx" ON "project_detail_settings_stages" USING btree ("_order");
  CREATE INDEX "project_detail_settings_stages_parent_id_idx" ON "project_detail_settings_stages" USING btree ("_parent_id");
  CREATE INDEX "project_detail_settings_stages_image_idx" ON "project_detail_settings_stages" USING btree ("image_id");
  CREATE INDEX "project_detail_settings_qa_docs_order_idx" ON "project_detail_settings_qa_docs" USING btree ("_order");
  CREATE INDEX "project_detail_settings_qa_docs_parent_id_idx" ON "project_detail_settings_qa_docs" USING btree ("_parent_id");
  CREATE INDEX "project_detail_settings_facts_order_idx" ON "project_detail_settings_facts" USING btree ("_order");
  CREATE INDEX "project_detail_settings_facts_parent_id_idx" ON "project_detail_settings_facts" USING btree ("_parent_id");
  CREATE INDEX "_project_detail_settings_v_version_stages_order_idx" ON "_project_detail_settings_v_version_stages" USING btree ("_order");
  CREATE INDEX "_project_detail_settings_v_version_stages_parent_id_idx" ON "_project_detail_settings_v_version_stages" USING btree ("_parent_id");
  CREATE INDEX "_project_detail_settings_v_version_stages_image_idx" ON "_project_detail_settings_v_version_stages" USING btree ("image_id");
  CREATE INDEX "_project_detail_settings_v_version_qa_docs_order_idx" ON "_project_detail_settings_v_version_qa_docs" USING btree ("_order");
  CREATE INDEX "_project_detail_settings_v_version_qa_docs_parent_id_idx" ON "_project_detail_settings_v_version_qa_docs" USING btree ("_parent_id");
  CREATE INDEX "_project_detail_settings_v_version_facts_order_idx" ON "_project_detail_settings_v_version_facts" USING btree ("_order");
  CREATE INDEX "_project_detail_settings_v_version_facts_parent_id_idx" ON "_project_detail_settings_v_version_facts" USING btree ("_parent_id");
  CREATE INDEX "_project_detail_settings_v_created_at_idx" ON "_project_detail_settings_v" USING btree ("created_at");
  CREATE INDEX "_project_detail_settings_v_updated_at_idx" ON "_project_detail_settings_v" USING btree ("updated_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "project_detail_settings_stages" CASCADE;
  DROP TABLE "project_detail_settings_qa_docs" CASCADE;
  DROP TABLE "project_detail_settings_facts" CASCADE;
  DROP TABLE "project_detail_settings" CASCADE;
  DROP TABLE "_project_detail_settings_v_version_stages" CASCADE;
  DROP TABLE "_project_detail_settings_v_version_qa_docs" CASCADE;
  DROP TABLE "_project_detail_settings_v_version_facts" CASCADE;
  DROP TABLE "_project_detail_settings_v" CASCADE;`)
}
