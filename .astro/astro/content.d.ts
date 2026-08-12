declare module 'astro:content' {
	interface RenderResult {
		Content: import('astro/runtime/server/index.js').AstroComponentFactory;
		headings: import('astro').MarkdownHeading[];
		remarkPluginFrontmatter: Record<string, any>;
	}
	interface Render {
		'.md': Promise<RenderResult>;
	}

	export interface RenderedContent {
		html: string;
		metadata?: {
			imagePaths: Array<string>;
			[key: string]: unknown;
		};
	}
}

declare module 'astro:content' {
	type Flatten<T> = T extends { [K: string]: infer U } ? U : never;

	export type CollectionKey = keyof AnyEntryMap;
	export type CollectionEntry<C extends CollectionKey> = Flatten<AnyEntryMap[C]>;

	export type ContentCollectionKey = keyof ContentEntryMap;
	export type DataCollectionKey = keyof DataEntryMap;

	type AllValuesOf<T> = T extends any ? T[keyof T] : never;
	type ValidContentEntrySlug<C extends keyof ContentEntryMap> = AllValuesOf<
		ContentEntryMap[C]
	>['slug'];

	/** @deprecated Use `getEntry` instead. */
	export function getEntryBySlug<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(
		collection: C,
		// Note that this has to accept a regular string too, for SSR
		entrySlug: E,
	): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;

	/** @deprecated Use `getEntry` instead. */
	export function getDataEntryById<C extends keyof DataEntryMap, E extends keyof DataEntryMap[C]>(
		collection: C,
		entryId: E,
	): Promise<CollectionEntry<C>>;

	export function getCollection<C extends keyof AnyEntryMap, E extends CollectionEntry<C>>(
		collection: C,
		filter?: (entry: CollectionEntry<C>) => entry is E,
	): Promise<E[]>;
	export function getCollection<C extends keyof AnyEntryMap>(
		collection: C,
		filter?: (entry: CollectionEntry<C>) => unknown,
	): Promise<CollectionEntry<C>[]>;

	export function getEntry<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(entry: {
		collection: C;
		slug: E;
	}): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof DataEntryMap,
		E extends keyof DataEntryMap[C] | (string & {}),
	>(entry: {
		collection: C;
		id: E;
	}): E extends keyof DataEntryMap[C]
		? Promise<DataEntryMap[C][E]>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(
		collection: C,
		slug: E,
	): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof DataEntryMap,
		E extends keyof DataEntryMap[C] | (string & {}),
	>(
		collection: C,
		id: E,
	): E extends keyof DataEntryMap[C]
		? Promise<DataEntryMap[C][E]>
		: Promise<CollectionEntry<C> | undefined>;

	/** Resolve an array of entry references from the same collection */
	export function getEntries<C extends keyof ContentEntryMap>(
		entries: {
			collection: C;
			slug: ValidContentEntrySlug<C>;
		}[],
	): Promise<CollectionEntry<C>[]>;
	export function getEntries<C extends keyof DataEntryMap>(
		entries: {
			collection: C;
			id: keyof DataEntryMap[C];
		}[],
	): Promise<CollectionEntry<C>[]>;

	export function render<C extends keyof AnyEntryMap>(
		entry: AnyEntryMap[C][string],
	): Promise<RenderResult>;

	export function reference<C extends keyof AnyEntryMap>(
		collection: C,
	): import('astro/zod').ZodEffects<
		import('astro/zod').ZodString,
		C extends keyof ContentEntryMap
			? {
					collection: C;
					slug: ValidContentEntrySlug<C>;
				}
			: {
					collection: C;
					id: keyof DataEntryMap[C];
				}
	>;
	// Allow generic `string` to avoid excessive type errors in the config
	// if `dev` is not running to update as you edit.
	// Invalid collection names will be caught at build time.
	export function reference<C extends string>(
		collection: C,
	): import('astro/zod').ZodEffects<import('astro/zod').ZodString, never>;

	type ReturnTypeOrOriginal<T> = T extends (...args: any[]) => infer R ? R : T;
	type InferEntrySchema<C extends keyof AnyEntryMap> = import('astro/zod').infer<
		ReturnTypeOrOriginal<Required<ContentConfig['collections'][C]>['schema']>
	>;

	type ContentEntryMap = {
		"blog": {
"2026/07/acid-base-disorders-renal-tubular-acidosis.md": {
	id: "2026/07/acid-base-disorders-renal-tubular-acidosis.md";
  slug: "2026/07/acid-base-disorders-renal-tubular-acidosis";
  body: string;
  collection: "blog";
  data: any
} & { render(): Render[".md"] };
"2026/08/atypical-presentation-neuroborreliosis.md": {
	id: "2026/08/atypical-presentation-neuroborreliosis.md";
  slug: "2026/08/atypical-presentation-neuroborreliosis";
  body: string;
  collection: "blog";
  data: any
} & { render(): Render[".md"] };
"2026/08/breakthrough-immunotherapy-glioblastoma.md": {
	id: "2026/08/breakthrough-immunotherapy-glioblastoma.md";
  slug: "2026/08/breakthrough-immunotherapy-glioblastoma";
  body: string;
  collection: "blog";
  data: any
} & { render(): Render[".md"] };
"2026/08/crispr-sickle-cell.md": {
	id: "2026/08/crispr-sickle-cell.md";
  slug: "2026/08/crispr-sickle-cell";
  body: string;
  collection: "blog";
  data: any
} & { render(): Render[".md"] };
"2026/08/high-yield-board-review-cardiology.md": {
	id: "2026/08/high-yield-board-review-cardiology.md";
  slug: "2026/08/high-yield-board-review-cardiology";
  body: string;
  collection: "blog";
  data: any
} & { render(): Render[".md"] };
"2026/08/mrna-cancer-vaccine-clinical-trials.md": {
	id: "2026/08/mrna-cancer-vaccine-clinical-trials.md";
  slug: "2026/08/mrna-cancer-vaccine-clinical-trials";
  body: string;
  collection: "blog";
  data: any
} & { render(): Render[".md"] };
"2026/08/nanotechnology-targeted-drug-delivery.md": {
	id: "2026/08/nanotechnology-targeted-drug-delivery.md";
  slug: "2026/08/nanotechnology-targeted-drug-delivery";
  body: string;
  collection: "blog";
  data: any
} & { render(): Render[".md"] };
"2026/08/neural-interfaces-mobility.md": {
	id: "2026/08/neural-interfaces-mobility.md";
  slug: "2026/08/neural-interfaces-mobility";
  body: string;
  collection: "blog";
  data: any
} & { render(): Render[".md"] };
"2026/08/pediatric-immunization-schedules-2026.md": {
	id: "2026/08/pediatric-immunization-schedules-2026.md";
  slug: "2026/08/pediatric-immunization-schedules-2026";
  body: string;
  collection: "blog";
  data: any
} & { render(): Render[".md"] };
"2026/08/rare-manifestation-takotsubo-cardiomyopathy.md": {
	id: "2026/08/rare-manifestation-takotsubo-cardiomyopathy.md";
  slug: "2026/08/rare-manifestation-takotsubo-cardiomyopathy";
  body: string;
  collection: "blog";
  data: any
} & { render(): Render[".md"] };
"2026/08/robotic-assisted-minimally-invasive-surgery.md": {
	id: "2026/08/robotic-assisted-minimally-invasive-surgery.md";
  slug: "2026/08/robotic-assisted-minimally-invasive-surgery";
  body: string;
  collection: "blog";
  data: any
} & { render(): Render[".md"] };
"2026/08/sound-wave-basics-detailed-study-notes-echocardiography.md": {
	id: "2026/08/sound-wave-basics-detailed-study-notes-echocardiography.md";
  slug: "2026/08/sound-wave-basics-detailed-study-notes-echocardiography";
  body: string;
  collection: "blog";
  data: any
} & { render(): Render[".md"] };
"2026/08/successful-management-refractory-status-epilepticus.md": {
	id: "2026/08/successful-management-refractory-status-epilepticus.md";
  slug: "2026/08/successful-management-refractory-status-epilepticus";
  body: string;
  collection: "blog";
  data: any
} & { render(): Render[".md"] };
"2026/08/transducer-basics-detailed-study-notes-echocardiography.md": {
	id: "2026/08/transducer-basics-detailed-study-notes-echocardiography.md";
  slug: "2026/08/transducer-basics-detailed-study-notes-echocardiography";
  body: string;
  collection: "blog";
  data: any
} & { render(): Render[".md"] };
"2026/08/wave-parameters-detailed-study-notes-echocardiography.md": {
	id: "2026/08/wave-parameters-detailed-study-notes-echocardiography.md";
  slug: "2026/08/wave-parameters-detailed-study-notes-echocardiography";
  body: string;
  collection: "blog";
  data: any
} & { render(): Render[".md"] };
};

	};

	type DataEntryMap = {
		
	};

	type AnyEntryMap = ContentEntryMap & DataEntryMap;

	export type ContentConfig = never;
}
