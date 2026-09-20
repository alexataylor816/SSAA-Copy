import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller is MOA
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: claims, error: claimsError } = await supabaseAuth.auth.getClaims(
      authHeader.replace("Bearer ", "")
    );
    if (claimsError || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerId = claims.claims.sub as string;

    // Use service role for admin operations
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check caller is MOA
    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", callerId)
      .single();

    if (!callerProfile || callerProfile.role !== "moa") {
      return new Response(JSON.stringify({ error: "Only MOA can delete companies" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { company_id, request_id } = await req.json();
    if (!company_id) {
      return new Response(JSON.stringify({ error: "company_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all profiles for this company to delete auth users later
    const { data: companyProfiles } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("company_id", company_id);

    const userIds = (companyProfiles || []).map((p) => p.user_id);

    // Get all projects owned by this company
    const { data: companyProjects } = await supabase
      .from("projects")
      .select("id")
      .eq("company_id", company_id);
    const projectIds = (companyProjects || []).map((p) => p.id);

    // Delete in dependency order

    // 1. Schedule requests (where company is requesting or sub)
    await supabase
      .from("schedule_requests")
      .delete()
      .or(`requesting_company_id.eq.${company_id},sub_company_id.eq.${company_id}`);

    // 2. Availability for company employees
    const { data: companyEmployees } = await supabase
      .from("employees")
      .select("id")
      .eq("company_id", company_id);
    const employeeIds = (companyEmployees || []).map((e) => e.id);

    if (employeeIds.length > 0) {
      await supabase
        .from("availability")
        .delete()
        .in("employee_id", employeeIds);

      await supabase
        .from("employee_project_assignments")
        .delete()
        .in("employee_id", employeeIds);
    }

    // 3. Tasks for company projects
    if (projectIds.length > 0) {
      await supabase.from("tasks").delete().in("project_id", projectIds);
      
      // Also delete tasks assigned to this company
      await supabase.from("tasks").delete().eq("assigned_company_id", company_id);
    }

    // 4. Project connections
    if (projectIds.length > 0) {
      await supabase
        .from("project_connections")
        .delete()
        .in("project_id", projectIds);
    }
    await supabase
      .from("project_connections")
      .delete()
      .eq("sub_company_id", company_id);

    // 5. User project assignments
    await supabase
      .from("user_project_assignments")
      .delete()
      .eq("company_id", company_id);

    // 6. Employee project assignments by company
    await supabase
      .from("employee_project_assignments")
      .delete()
      .eq("company_id", company_id);

    // 7. Guest connections
    await supabase
      .from("guest_project_connections")
      .delete()
      .or(`guest_company_id.eq.${company_id},sub_company_id.eq.${company_id}`);

    await supabase
      .from("guest_gc_links")
      .delete()
      .eq("sub_company_id", company_id);

    // 8. Company join requests (also delete requests where user belongs to this company)
    await supabase
      .from("company_join_requests")
      .delete()
      .eq("company_id", company_id);
    if (userIds.length > 0) {
      await supabase
        .from("company_join_requests")
        .delete()
        .in("user_id", userIds);
    }

    // 9. Employees
    await supabase.from("employees").delete().eq("company_id", company_id);

    // 10. Company subscriptions
    await supabase
      .from("company_subscriptions")
      .delete()
      .eq("company_id", company_id);

    // 11. Notification preferences
    await supabase
      .from("notification_preferences")
      .delete()
      .eq("company_id", company_id);

    // 12. Notification log
    await supabase
      .from("notification_log")
      .delete()
      .eq("recipient_company_id", company_id);

    // 13. User roles
    await supabase.from("user_roles").delete().eq("company_id", company_id);

    // 14. Projects
    if (projectIds.length > 0) {
      await supabase.from("projects").delete().in("id", projectIds);
    }

    // 15. Profile email sync queue
    if (userIds.length > 0) {
      await supabase
        .from("profile_email_sync_queue")
        .delete()
        .in("user_id", userIds);
    }

    // 16. Profiles
    await supabase.from("profiles").delete().eq("company_id", company_id);

    // 17. Delete auth users
    for (const userId of userIds) {
      await supabase.auth.admin.deleteUser(userId);
    }

    // 18. Delete deletion requests for this company
    await supabase
      .from("company_deletion_requests")
      .delete()
      .eq("company_id", company_id);

    // 19. Delete the company itself
    await supabase.from("companies").delete().eq("id", company_id);

    // Mark the specific request as confirmed if provided
    if (request_id) {
      // Already deleted above, but just in case
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error deleting company:", error);
    return new Response(
      JSON.stringify({ error: "An error occurred while deleting the company" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
