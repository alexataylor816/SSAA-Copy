import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const OMO_EMAIL = "lukepaaron@gmail.com";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    // Verify caller is OMO
    const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: callerUser }, error: authError } = await callerClient.auth.getUser();
    if (authError || !callerUser) {
      throw new Error("Unauthorized");
    }

    const { data: callerProfile } = await callerClient
      .from("profiles")
      .select("role, email")
      .eq("user_id", callerUser.id)
      .single();

    if (!callerProfile || callerProfile.role !== "moa" || callerProfile.email.toLowerCase() !== OMO_EMAIL) {
      throw new Error("Unauthorized: Only the Original Main Operator can manage operators");
    }

    const { action, ...body } = await req.json();

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    if (action === "create") {
      const { email, full_name, operator_level, password } = body;

      if (!email || !password || !operator_level) {
        throw new Error("Missing required fields: email, password, operator_level");
      }

      if (!["main_operator", "operator"].includes(operator_level)) {
        throw new Error("Invalid operator_level");
      }

      // Check if operator already exists
      const { data: existingOperator } = await adminClient
        .from("operators")
        .select("id")
        .eq("email", email.toLowerCase())
        .single();

      if (existingOperator) {
        throw new Error("An operator with this email already exists");
      }

      // Check if auth user already exists
      const { data: existingUsers } = await adminClient.auth.admin.listUsers();
      const existingUser = existingUsers?.users?.find(
        (u) => u.email?.toLowerCase() === email.toLowerCase()
      );

      let userId: string;
      let isNewUser = true;
      let previousRole: string | null = null;
      let previousCompanyId: string | null = null;

      if (existingUser) {
        // Reuse existing auth user
        userId = existingUser.id;
        isNewUser = false;

        // Fetch current profile state before changing
        const { data: currentProfile } = await adminClient
          .from("profiles")
          .select("role, company_id")
          .eq("user_id", userId)
          .single();

        if (currentProfile) {
          previousRole = currentProfile.role;
          previousCompanyId = currentProfile.company_id;
        }

        // Update the existing user's password so the temporary password works
        const { error: pwError } = await adminClient.auth.admin.updateUserById(userId, {
          password,
        });
        if (pwError) {
          console.error("Password update error:", pwError);
          throw new Error(`Failed to set temporary password: ${pwError.message}`);
        }

        // Use the service_role_update_profile function to bypass the trigger
        const { error: rpcError } = await adminClient.rpc("service_role_update_profile_for_operator", {
          p_user_id: userId,
          p_role: "moa",
          p_full_name: full_name || null,
          p_force_password_change: true,
          p_company_id: null,
        });

        if (rpcError) {
          console.error("Profile update error:", rpcError);
          throw new Error(`Failed to update profile: ${rpcError.message}`);
        }
      } else {
        // Create new auth user
        const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name, company_id: null },
        });

        if (createError) {
          throw new Error(`Failed to create user: ${createError.message}`);
        }

        userId = newUser.user!.id;

        // Use the service_role_update_profile function to set moa role
        const { error: rpcError } = await adminClient.rpc("service_role_update_profile_for_operator", {
          p_user_id: userId,
          p_role: "moa",
          p_full_name: full_name || null,
          p_force_password_change: true,
        });

        if (rpcError) {
          console.error("Profile update error:", rpcError);
        }
      }

      // Insert into operators table
      const { error: operatorError } = await adminClient
        .from("operators")
        .insert({
          user_id: userId,
          email,
          full_name,
          operator_level,
          created_by: callerUser.id,
          is_new_user: isNewUser,
          previous_role: previousRole,
          previous_company_id: previousCompanyId,
        });

      if (operatorError) {
        if (isNewUser) {
          await adminClient.auth.admin.deleteUser(userId);
        }
        throw new Error(`Failed to create operator record: ${operatorError.message}`);
      }

      // Send welcome email via Resend
      let emailSent = false;
      let emailError: string | null = null;
      try {
        const resendApiKey = Deno.env.get("RESEND_API_KEY_1") || Deno.env.get("RESEND_API_KEY");
        const rawSender = Deno.env.get("SENDER_EMAIL") || "SSAA <noreply@ssaainc.com>";
        const senderAddress = rawSender.includes("<") ? rawSender : `SSAA <${rawSender}>`;
        const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

        if (resendApiKey && lovableApiKey) {
          const levelLabel = operator_level === "main_operator" ? "Main Operator" : "Operator";
          const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h1 style="color: #1a365d; font-size: 24px; margin-bottom: 20px;">Welcome to SSAA</h1>
              <p style="font-size: 16px; color: #333; line-height: 1.6;">
                Dear ${full_name || email},
              </p>
              <p style="font-size: 16px; color: #333; line-height: 1.6;">
                We're thrilled to have you on board as a <strong>${levelLabel}</strong> on the SSAA Operator Dashboard. 
                You now have access to powerful tools to oversee and manage projects across our platform.
              </p>
              <div style="background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <p style="font-size: 14px; color: #555; margin: 0 0 10px 0;"><strong>Your Login Credentials:</strong></p>
                <p style="font-size: 14px; color: #333; margin: 0 0 5px 0;">Email: <strong>${email}</strong></p>
                <p style="font-size: 14px; color: #333; margin: 0;">Temporary Password: <strong>${password}</strong></p>
              </div>
              <p style="font-size: 16px; color: #333; line-height: 1.6;">
                <strong>Important:</strong> For your security, please reset your password at your earliest convenience. 
                You can do this by:
              </p>
              <ul style="font-size: 14px; color: #333; line-height: 1.8;">
                <li>Logging in and going to <strong>"Manage My Profile"</strong></li>
                <li>Or by clicking <strong>"Forgot Password"</strong> on the main login page</li>
              </ul>
              <p style="font-size: 16px; color: #333; line-height: 1.6;">
                We look forward to working with you. If you have any questions, don't hesitate to reach out.
              </p>
              <p style="font-size: 16px; color: #333; line-height: 1.6;">
                Best regards,<br/>
                <strong>The SSAA Team</strong>
              </p>
            </div>
          `;

          const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
          const emailResponse = await fetch(`${GATEWAY_URL}/emails`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${lovableApiKey}`,
              "X-Connection-Api-Key": resendApiKey,
            },
            body: JSON.stringify({
              from: senderAddress,
              to: [email],
              subject: "Welcome to SSAA — Your Operator Account is Ready",
              html: emailHtml,
            }),
          });

          const emailResult = await emailResponse.json();
          
          if (!emailResponse.ok || emailResult.error) {
            emailError = emailResult.error?.message || emailResult.message || `Email API returned ${emailResponse.status}`;
            console.error("Email send failed:", emailError, emailResult);
          } else {
            emailSent = true;
            console.log("Welcome email sent successfully:", emailResult);
          }
        } else {
          emailError = "Email configuration missing (RESEND_API_KEY or LOVABLE_API_KEY not set)";
          console.error(emailError);
        }
      } catch (err) {
        emailError = err instanceof Error ? err.message : "Unknown email error";
        console.error("Error sending welcome email:", err);
      }

      return new Response(
        JSON.stringify({ success: true, user_id: userId, emailSent, emailError }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (action === "update") {
      const { operator_id, operator_level, full_name } = body;

      if (!operator_id) throw new Error("Missing operator_id");

      const updateData: Record<string, string> = {};
      if (operator_level) updateData.operator_level = operator_level;
      if (full_name !== undefined) updateData.full_name = full_name;

      const { error } = await adminClient
        .from("operators")
        .update(updateData)
        .eq("id", operator_id);

      if (error) throw new Error(`Failed to update operator: ${error.message}`);

      // Also update profile full_name if changed
      if (full_name !== undefined) {
        const { data: op } = await adminClient
          .from("operators")
          .select("user_id")
          .eq("id", operator_id)
          .single();

        if (op) {
          await adminClient
            .from("profiles")
            .update({ full_name })
            .eq("user_id", op.user_id);
        }
      }

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (action === "delete") {
      const { operator_id } = body;
      if (!operator_id) throw new Error("Missing operator_id");

      // Get operator record with state info
      const { data: op } = await adminClient
        .from("operators")
        .select("user_id, is_new_user, previous_role, previous_company_id")
        .eq("id", operator_id)
        .single();

      if (!op) throw new Error("Operator not found");

      // Delete operator record
      const { error: delError } = await adminClient
        .from("operators")
        .delete()
        .eq("id", operator_id);

      if (delError) throw new Error(`Failed to delete operator: ${delError.message}`);

      if (op.is_new_user) {
        // Brand new account — delete the auth user entirely
        await adminClient.auth.admin.deleteUser(op.user_id);
      } else {
        // Existing user — restore their previous state
        const restoreRole = op.previous_role || "admin";
        const restoreCompanyId = op.previous_company_id || null;

        const { error: rpcError } = await adminClient.rpc("service_role_update_profile_for_operator", {
          p_user_id: op.user_id,
          p_role: restoreRole,
          p_force_password_change: false,
          p_company_id: restoreCompanyId,
        });

        if (rpcError) {
          console.error("Failed to restore profile:", rpcError);
        }
      }

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    throw new Error("Invalid action");
  } catch (error: any) {
    console.error("Error in create-operator:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
