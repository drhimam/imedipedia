import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    pubDate: z.coerce.date(),
    description: z.string(),
    author: z.string(),
    image: z.string().optional(),
    tag: z.string().optional(),
    type: z.enum(['general', 'update', 'case', 'education']).default('general'),
    subject: z.string().optional(),
    topic: z.string().optional(),
    exams: z.array(z.string()).optional(),
  }),
});

export const collections = { blog };
