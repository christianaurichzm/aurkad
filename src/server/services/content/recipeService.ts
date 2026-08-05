// Crafting recipes. Cached: the crafting module resolves a recipe when a player
// crafts, which happens inside the tick. The document lives here rather than in
// the module because the content editor owns it.

import RecipeModel from '../../model/Recipe.js';
import type { Recipe } from '../../../shared/types.js';

const recipes = new Map<string, Recipe>();

export function getRecipeById(id: string): Recipe | undefined {
  return recipes.get(id);
}

/** Every loaded id, for validating content that references them. */
export function knownRecipeIds(): Set<string> {
  return new Set(recipes.keys());
}

export function cachedRecipes(): Recipe[] {
  return [...recipes.values()];
}

export async function loadRecipes(): Promise<void> {
  const rows = await RecipeModel.find().lean<Recipe[]>().exec();
  recipes.clear();
  for (const row of rows) recipes.set(row.id, row);
}

export async function listRecipes(): Promise<Recipe[]> {
  return await RecipeModel.find().lean<Recipe[]>().exec();
}

export async function createOrUpdateRecipe(recipe: Recipe): Promise<void> {
  await RecipeModel.findOneAndUpdate({ id: recipe.id }, recipe, {
    upsert: true,
  });
  // Refresh the cache so an edited cost applies to the next craft instead of
  // after a restart. Deep copy, like the others: the caller keeps a reference
  // to the ingredient list, and the cache is read inside the tick.
  recipes.set(recipe.id, structuredClone(recipe));
}

export async function deleteRecipe(id: string): Promise<void> {
  await RecipeModel.deleteOne({ id });
  recipes.delete(id);
}

export function clearRecipeCache(): void {
  recipes.clear();
}
