
import { supabase } from "./supabase";

async function testConnection() {
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    console.error("Sign in before testing access to complaints.");
    return;
  }

  const { error } = await supabase
    .from("complaints")
    .select("id")
    .limit(1);

  if (error) {
    console.error("Supabase connection test failed:", error.message);
  } else {
    console.log("Supabase connection successful!");
  }
}

testConnection();
