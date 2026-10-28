// Crafting recipes. Cached: the crafting module resolves a recipe when a player
// crafts, which happens inside the tick. The document lives here rather than in
// the module because the content editor owns it: anything with an id, a schema
// and a reference from other content is the editor's, whatever module decides
// what it means.

import { z } from 'zod';
import RecipeModel from '../../model/Recipe.js';
import { contentCache } from '../../persistence/contentCache.js';
import type { Recipe } from '../../../shared/types.js';

const RecipeIngredientSchema = z.object({
  itemId: z.number().int().nonnegative(),
  quantity: z.number().int().positive().max(10_000),
});

export const RecipeSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  // At least one input: a recipe that consumes nothing produces items from
  // thin air, which is the one thing the economy is not allowed to do.
  inputs: z.array(RecipeIngredientSchema).min(1).max(20),
  output: RecipeIngredientSchema,
  condition: z.string().min(1).max(64).optional(),
});

const recipes = contentCache<Recipe>(RecipeModel, RecipeSchema);

export const cachedRecipes = recipes.all;
export const loadRecipes = recipes.load;
export const listRecipes = recipes.list;
export const createOrUpdateRecipe = recipes.upsert;
export const deleteRecipe = recipes.remove;
export const clearRecipeCache = recipes.clear;
