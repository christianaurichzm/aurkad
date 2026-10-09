// Crafting recipes. Cached: the crafting module resolves a recipe when a player
// crafts, which happens inside the tick. The document lives here rather than in
// the module because the content editor owns it: anything with an id, a schema
// and a reference from other content is the editor's, whatever module decides
// what it means.

import RecipeModel from '../../model/Recipe.js';
import { contentCache } from '../../persistence/contentCache.js';
import type { Recipe } from '../../../shared/types.js';

const recipes = contentCache<Recipe>(RecipeModel);

export const cachedRecipes = recipes.all;
export const loadRecipes = recipes.load;
export const listRecipes = recipes.list;
export const createOrUpdateRecipe = recipes.upsert;
export const deleteRecipe = recipes.remove;
export const clearRecipeCache = recipes.clear;
