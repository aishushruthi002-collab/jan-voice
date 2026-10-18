
import { supabase } from "./supabase";

async function testConnection() {
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
