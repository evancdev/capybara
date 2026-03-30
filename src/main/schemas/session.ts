import { z } from 'zod'

export const ProjectPathSchema = z.string().min(1)
