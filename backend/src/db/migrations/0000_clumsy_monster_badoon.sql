CREATE TABLE "servers" (
	"id" serial PRIMARY KEY NOT NULL,
	"container_name" text NOT NULL,
	"display_name" text NOT NULL,
	"data_path" text NOT NULL,
	"rcon_host" text,
	"rcon_port" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "servers_container_name_unique" UNIQUE("container_name")
);
