import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "home_page_stats" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"value" varchar NOT NULL,
  	"suffix" varchar,
  	"label" varchar NOT NULL
  );
  
  CREATE TABLE "home_page_certifications" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL
  );
  
  CREATE TABLE "home_page_explore_cards" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"body" varchar,
  	"cta_label" varchar NOT NULL,
  	"href" varchar NOT NULL
  );
  
  CREATE TABLE "home_page" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"hero_kicker" varchar NOT NULL,
  	"hero_title" varchar NOT NULL,
  	"hero_highlight" varchar,
  	"hero_lede" varchar NOT NULL,
  	"hero_primary_label" varchar DEFAULT 'Request a Quote' NOT NULL,
  	"hero_primary_href" varchar DEFAULT '/quote' NOT NULL,
  	"hero_secondary_label" varchar NOT NULL,
  	"hero_secondary_href" varchar NOT NULL,
  	"hero_image_id" integer,
  	"certifications_label" varchar DEFAULT 'Certified & compliant',
  	"office_split_eyebrow" varchar,
  	"office_split_title" varchar NOT NULL,
  	"office_split_body" varchar,
  	"office_split_image_id" integer,
  	"office_split_image_alt" varchar,
  	"explore_intro_eyebrow" varchar,
  	"explore_intro_title" varchar NOT NULL,
  	"explore_intro_body" varchar,
  	"featured_section_eyebrow" varchar DEFAULT 'Featured Project',
  	"featured_section_cta_label" varchar DEFAULT 'View Project Details',
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "_home_page_v_version_stats" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"value" varchar NOT NULL,
  	"suffix" varchar,
  	"label" varchar NOT NULL,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_home_page_v_version_certifications" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_home_page_v_version_explore_cards" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"body" varchar,
  	"cta_label" varchar NOT NULL,
  	"href" varchar NOT NULL,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_home_page_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version_hero_kicker" varchar NOT NULL,
  	"version_hero_title" varchar NOT NULL,
  	"version_hero_highlight" varchar,
  	"version_hero_lede" varchar NOT NULL,
  	"version_hero_primary_label" varchar DEFAULT 'Request a Quote' NOT NULL,
  	"version_hero_primary_href" varchar DEFAULT '/quote' NOT NULL,
  	"version_hero_secondary_label" varchar NOT NULL,
  	"version_hero_secondary_href" varchar NOT NULL,
  	"version_hero_image_id" integer,
  	"version_certifications_label" varchar DEFAULT 'Certified & compliant',
  	"version_office_split_eyebrow" varchar,
  	"version_office_split_title" varchar NOT NULL,
  	"version_office_split_body" varchar,
  	"version_office_split_image_id" integer,
  	"version_office_split_image_alt" varchar,
  	"version_explore_intro_eyebrow" varchar,
  	"version_explore_intro_title" varchar NOT NULL,
  	"version_explore_intro_body" varchar,
  	"version_featured_section_eyebrow" varchar DEFAULT 'Featured Project',
  	"version_featured_section_cta_label" varchar DEFAULT 'View Project Details',
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "home_page_stats" ADD CONSTRAINT "home_page_stats_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."home_page"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "home_page_certifications" ADD CONSTRAINT "home_page_certifications_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."home_page"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "home_page_explore_cards" ADD CONSTRAINT "home_page_explore_cards_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."home_page"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "home_page" ADD CONSTRAINT "home_page_hero_image_id_media_id_fk" FOREIGN KEY ("hero_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "home_page" ADD CONSTRAINT "home_page_office_split_image_id_media_id_fk" FOREIGN KEY ("office_split_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_home_page_v_version_stats" ADD CONSTRAINT "_home_page_v_version_stats_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_home_page_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_home_page_v_version_certifications" ADD CONSTRAINT "_home_page_v_version_certifications_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_home_page_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_home_page_v_version_explore_cards" ADD CONSTRAINT "_home_page_v_version_explore_cards_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_home_page_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_home_page_v" ADD CONSTRAINT "_home_page_v_version_hero_image_id_media_id_fk" FOREIGN KEY ("version_hero_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_home_page_v" ADD CONSTRAINT "_home_page_v_version_office_split_image_id_media_id_fk" FOREIGN KEY ("version_office_split_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "home_page_stats_order_idx" ON "home_page_stats" USING btree ("_order");
  CREATE INDEX "home_page_stats_parent_id_idx" ON "home_page_stats" USING btree ("_parent_id");
  CREATE INDEX "home_page_certifications_order_idx" ON "home_page_certifications" USING btree ("_order");
  CREATE INDEX "home_page_certifications_parent_id_idx" ON "home_page_certifications" USING btree ("_parent_id");
  CREATE INDEX "home_page_explore_cards_order_idx" ON "home_page_explore_cards" USING btree ("_order");
  CREATE INDEX "home_page_explore_cards_parent_id_idx" ON "home_page_explore_cards" USING btree ("_parent_id");
  CREATE INDEX "home_page_hero_hero_image_idx" ON "home_page" USING btree ("hero_image_id");
  CREATE INDEX "home_page_office_split_office_split_image_idx" ON "home_page" USING btree ("office_split_image_id");
  CREATE INDEX "_home_page_v_version_stats_order_idx" ON "_home_page_v_version_stats" USING btree ("_order");
  CREATE INDEX "_home_page_v_version_stats_parent_id_idx" ON "_home_page_v_version_stats" USING btree ("_parent_id");
  CREATE INDEX "_home_page_v_version_certifications_order_idx" ON "_home_page_v_version_certifications" USING btree ("_order");
  CREATE INDEX "_home_page_v_version_certifications_parent_id_idx" ON "_home_page_v_version_certifications" USING btree ("_parent_id");
  CREATE INDEX "_home_page_v_version_explore_cards_order_idx" ON "_home_page_v_version_explore_cards" USING btree ("_order");
  CREATE INDEX "_home_page_v_version_explore_cards_parent_id_idx" ON "_home_page_v_version_explore_cards" USING btree ("_parent_id");
  CREATE INDEX "_home_page_v_version_hero_version_hero_image_idx" ON "_home_page_v" USING btree ("version_hero_image_id");
  CREATE INDEX "_home_page_v_version_office_split_version_office_split_i_idx" ON "_home_page_v" USING btree ("version_office_split_image_id");
  CREATE INDEX "_home_page_v_created_at_idx" ON "_home_page_v" USING btree ("created_at");
  CREATE INDEX "_home_page_v_updated_at_idx" ON "_home_page_v" USING btree ("updated_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "home_page_stats" CASCADE;
  DROP TABLE "home_page_certifications" CASCADE;
  DROP TABLE "home_page_explore_cards" CASCADE;
  DROP TABLE "home_page" CASCADE;
  DROP TABLE "_home_page_v_version_stats" CASCADE;
  DROP TABLE "_home_page_v_version_certifications" CASCADE;
  DROP TABLE "_home_page_v_version_explore_cards" CASCADE;
  DROP TABLE "_home_page_v" CASCADE;`)
}
