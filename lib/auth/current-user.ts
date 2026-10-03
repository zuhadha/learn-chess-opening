/**
 * Identity seam.
 *
 * The prototype runs without auth (a single local learner), but every table is
 * already keyed by `user_id` and every query takes it as a parameter, so wiring
 * Supabase Auth is a one-function change:
 *
 *   export async function getCurrentUserId() {
 *     const { data } = await supabase.auth.getUser();
 *     return data.user?.id ?? null;
 *   }
 *
 * Nothing else in the codebase knows which learner is signed in.
 */

export const LOCAL_USER_ID = "11111111-1111-4111-8111-111111111111";

export const LOCAL_USERNAME = "Local Learner";

export function getCurrentUserId(): string {
  return LOCAL_USER_ID;
}
