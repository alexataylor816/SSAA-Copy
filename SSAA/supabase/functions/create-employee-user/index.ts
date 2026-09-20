import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_PERMISSION_LEVELS = ['standard', 'partial', 'full', 'account_holder', 'basic', 'level_1'];

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 255;
}

function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

interface CreateEmployeeUserRequest {
  email: string;
  name: string;
  companyId: string;
  permissionLevel: string;
  employeeId: string;
  password?: string;
  resetPassword?: string;
  targetUserId?: string;
}

// Single source of truth for the credentials welcome email so brand-new and
// re-created (already existing login) employees receive exactly the same mail.
async function sendWelcomeEmail(resend: any, name: string, normalizedEmail: string, password: string): Promise<boolean> {
  const safeName = escapeHtml(name);
  const baseUrl = "https://ssaainc.com";
  const setupUrl = `${baseUrl}/onboarding-reset?email=${encodeURIComponent(normalizedEmail)}&temp=${encodeURIComponent(password)}`;
  try {
    const emailResponse = await resend.emails.send({
      from: "SSAA <noreply@ssaainc.com>",
      to: [normalizedEmail],
      subject: "Welcome to SSAA - Your Account Details",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #1a1a1a; font-size: 24px;">Welcome to SSAA, ${safeName}!</h1>
          <p style="color: #555; font-size: 16px; line-height: 1.5;">An account has been created for you. The fastest way to get started is to click the button below — it will sign you in automatically and let you choose your own password.</p>
          <p style="margin: 24px 0; text-align: center;">
            <a href="${setupUrl}" style="display: inline-block; padding: 14px 28px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: bold;">Set Up Your Account</a>
          </p>
          <div style="background-color: #f4f4f5; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0; font-size: 14px; color: #555;"><strong>Or log in manually with these credentials:</strong></p>
            <p style="margin: 0 0 10px 0; font-size: 14px; color: #555;">Username (Email):</p>
            <p style="margin: 0 0 15px 0; font-size: 16px; color: #1a1a1a;">${escapeHtml(normalizedEmail)}</p>
            <p style="margin: 0 0 10px 0; font-size: 14px; color: #555;">Temporary Password:</p>
            <p style="margin: 0; font-size: 16px; color: #1a1a1a;">${escapeHtml(password)}</p>
            <p style="margin: 16px 0 0 0; font-size: 13px; color: #666;">
              <a href="${baseUrl}" style="color: #3b82f6;">Open the login page</a>
            </p>
          </div>
          <div style="background-color: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin: 20px 0;">
            <p style="margin: 0; font-size: 14px; color: #92400e;">⚠️ You will be prompted to choose a new password the first time you log in.</p>
          </div>
          <p style="color: #555; font-size: 14px;">If you didn't expect this email, please contact your administrator.</p>
          <p style="color: #555; font-size: 14px;">Best regards,<br>The SSAA Team</p>
        </div>
      `,
    });
    if ((emailResponse as any)?.error) {
      console.error("Welcome email send error:", (emailResponse as any).error);
      return false;
    }
    console.log("Welcome email sent:", emailResponse);
    return true;
  } catch (emailError) {
    console.error("Error sending welcome email:", emailError);
    return false;
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAdmin = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // This function creates auth users, so the caller must be an authenticated
    // administrator of the target company (or a platform operator).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    const callerId = callerData.user.id;

    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

    const body: CreateEmployeeUserRequest = await req.json();
    const { email, name, companyId, permissionLevel, employeeId, password, resetPassword, targetUserId } = body;

    const [{ data: callerOperator }, { data: callerProfile }] = await Promise.all([
      supabaseAdmin
        .from("operators")
        .select("user_id")
        .eq("user_id", callerId)
        .maybeSingle(),
      supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("user_id", callerId)
        .maybeSingle(),
    ]);
    // MOA users are platform operators even when they are not listed in the
    // operator-management roster table.
    const isOperator = !!callerOperator || callerProfile?.role === "moa";

    const callerMayManageCompany = async (targetCompanyId: string | undefined | null) => {
      if (isOperator) return true;
      if (!targetCompanyId || !isValidUUID(targetCompanyId)) return false;
      const { data: role } = await supabaseAdmin
        .from("user_roles")
        .select("permission_level")
        .eq("user_id", callerId)
        .eq("company_id", targetCompanyId)
        .maybeSingle();
      return !!role && ["account_holder", "full", "partial"].includes(role.permission_level as string);
    };

    // Handle admin resetting an existing user's password
    if (resetPassword && targetUserId) {
      // Validate inputs
      if (!isValidUUID(targetUserId)) {
        throw new Error("Invalid targetUserId format");
      }
      if (typeof resetPassword !== "string" || resetPassword.length < 6 || resetPassword.length > 72) {
        throw new Error("Password must be between 6 and 72 characters");
      }

      // The target must belong to a company the caller administers.
      const { data: targetProfile } = await supabaseAdmin
        .from("profiles")
        .select("company_id")
        .eq("user_id", targetUserId)
        .maybeSingle();
      if (!(await callerMayManageCompany(targetProfile?.company_id))) {
        return new Response(JSON.stringify({ error: "You are not allowed to manage this user." }), {
          status: 403,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }


      console.log("Admin resetting password for user:", targetUserId);
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
        password: resetPassword,
      });
      if (updateError) throw updateError;

      await supabaseAdmin
        .from("profiles")
        .update({ force_password_change: true })
        .eq("user_id", targetUserId);

      return new Response(
        JSON.stringify({ message: "Password reset successfully" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Validate required fields
    if (!email || !isValidEmail(email)) {
      throw new Error("Invalid or missing email address");
    }
    if (!name || typeof name !== "string" || name.length > 255) {
      throw new Error("Invalid or missing name (max 255 chars)");
    }
    if (!companyId || !isValidUUID(companyId)) {
      throw new Error("Invalid or missing companyId");
    }
    if (!permissionLevel || !VALID_PERMISSION_LEVELS.includes(permissionLevel)) {
      throw new Error(`Invalid permissionLevel. Must be one of: ${VALID_PERMISSION_LEVELS.join(', ')}`);
    }
    if (!employeeId || !isValidUUID(employeeId)) {
      throw new Error("Invalid or missing employeeId");
    }
    if (password && (typeof password !== "string" || password.length < 6 || password.length > 72)) {
      throw new Error("Password must be between 6 and 72 characters");
    }

    if (!(await callerMayManageCompany(companyId))) {
      return new Response(JSON.stringify({ error: "You are not allowed to add personnel to this company." }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // The employee row must belong to the company the caller administers.
    const { data: employeeRow } = await supabaseAdmin
      .from("employees")
      .select("company_id")
      .eq("id", employeeId)
      .maybeSingle();
    if (!employeeRow || employeeRow.company_id !== companyId) {
      return new Response(JSON.stringify({ error: "Employee information is missing." }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Guest accounts: every member is a Main Company Account Holder. Force it
    // server-side regardless of the client-submitted level.
    let effectivePermissionLevel = permissionLevel;
    try {
      const { data: companyRow } = await supabaseAdmin
        .from("companies")
        .select("is_guest")
        .eq("id", companyId)
        .single();
      if (companyRow?.is_guest) effectivePermissionLevel = "account_holder";
    } catch (e) {
      console.error("Guest-company check failed (using submitted permission):", e);
    }

    console.log("Creating user for employee:", { email: normalizedEmail, name, companyId, permissionLevel: effectivePermissionLevel, employeeId, hasPassword: !!password });


    // Check if user with this email already exists (case-insensitive)
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email?.toLowerCase() === normalizedEmail);

    if (existingUser) {
      console.log("User already exists, checking company ownership");

      // CRITICAL: Check if this user already belongs to a DIFFERENT company
      const { data: existingProfile } = await supabaseAdmin
        .from("profiles")
        .select("company_id")
        .eq("user_id", existingUser.id)
        .single();

      if (existingProfile?.company_id && existingProfile.company_id !== companyId) {
        // User belongs to another company — do NOT link the employee record cross-company
        return new Response(
          JSON.stringify({ 
            userId: existingUser.id, 
            isExisting: true,
            belongsToDifferentCompany: true,
            message: "This email belongs to a user in a different company. Employee was not linked." 
          }),
          { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // User has no company or same company — safe to link fully
      await supabaseAdmin
        .from("employees")
        .update({ linked_user_id: existingUser.id })
        .eq("id", employeeId);

      const profileUpdate: any = {};
      if (name) profileUpdate.full_name = name;
      profileUpdate.company_id = companyId;

      const { data: empRecord } = await supabaseAdmin
        .from("employees")
        .select("phone")
        .eq("id", employeeId)
        .single();
      if (empRecord?.phone) profileUpdate.phone = empRecord.phone;

      // Re-adding someone whose login still exists must behave like a fresh
      // account: apply the supplied temporary password and re-prompt on login.
      if (password) {
        const { error: pwError } = await supabaseAdmin.auth.admin.updateUserById(existingUser.id, { password });
        if (pwError) console.error("Error setting password on existing user:", pwError);
        profileUpdate.force_password_change = true;
      }

      await supabaseAdmin
        .from("profiles")
        .update(profileUpdate)
        .eq("user_id", existingUser.id);

      const { data: existingRole } = await supabaseAdmin
        .from("user_roles")
        .select("id")
        .eq("user_id", existingUser.id)
        .eq("company_id", companyId)
        .maybeSingle();

      if (!existingRole) {
        await supabaseAdmin.from("user_roles").insert({
          user_id: existingUser.id,
          company_id: companyId,
          permission_level: effectivePermissionLevel,
        });
      }

      let emailSent = false;
      if (password) {
        emailSent = await sendWelcomeEmail(resend, name, normalizedEmail, password);
      }

      return new Response(
        JSON.stringify({ 
          userId: existingUser.id, 
          isExisting: true,
          passwordSet: !!password,
          emailSent,
          message: "Existing user linked to employee" 
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Create new auth user
    const createUserOptions: any = {
      email: normalizedEmail,
      email_confirm: true,
      user_metadata: { 
        full_name: name,
        company_id: companyId 
      },
    };

    if (password) {
      createUserOptions.password = password;
    }

    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser(createUserOptions);

    if (createError) {
      console.error("Error creating user:", createError);
      throw createError;
    }

    console.log("User created:", newUser.user?.id);

    await new Promise(resolve => setTimeout(resolve, 500));

    const profileUpdate: any = { company_id: companyId };
    if (password) {
      profileUpdate.force_password_change = true;
    }

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update(profileUpdate)
      .eq("user_id", newUser.user!.id);

    if (profileError) {
      console.error("Error updating profile:", profileError);
    }

    const { error: roleError } = await supabaseAdmin.from("user_roles").insert({
      user_id: newUser.user!.id,
      company_id: companyId,
      permission_level: effectivePermissionLevel,
    });

    if (roleError) {
      console.error("Error creating user role:", roleError);
    }

    const { error: employeeError } = await supabaseAdmin
      .from("employees")
      .update({ linked_user_id: newUser.user!.id })
      .eq("id", employeeId);

    if (employeeError) {
      console.error("Error linking employee:", employeeError);
    }

    // Send appropriate email based on whether a password was provided
    let newUserEmailSent = false;
    if (!password) {
      const { data: resetData, error: resetError } = await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email,
      });

      if (resetError) {
        console.error("Error generating reset link:", resetError);
      } else if (resetData?.properties?.action_link) {
        console.log("Password reset link generated, sending email");

        const safeName = escapeHtml(name);
        const emailResponse = await resend.emails.send({
          from: "SSAA <noreply@ssaainc.com>",
          to: [email],
          subject: "Welcome! Set up your account password",
          html: `
            <h1>Welcome, ${safeName}!</h1>
            <p>An account has been created for you. Please click the link below to set up your password:</p>
            <p><a href="${resetData.properties.action_link}" style="display: inline-block; padding: 12px 24px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 6px;">Set Up Your Password</a></p>
            <p>If you didn't expect this email, you can safely ignore it.</p>
            <p>Best regards,<br>The Team</p>
          `,
        });

        console.log("Email sent:", emailResponse);
      }
    } else {
      console.log("Sending welcome email with credentials to:", normalizedEmail);
      newUserEmailSent = await sendWelcomeEmail(resend, name, normalizedEmail, password);
    }

    return new Response(
      JSON.stringify({ 
        userId: newUser.user!.id, 
        isExisting: false,
        passwordSet: !!password,
        emailSent: newUserEmailSent,
        message: password ? "User created with password" : "User created and invitation sent" 
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: any) {
    console.error("Error in create-employee-user:", error);
    // Map known errors to safe client messages
    const msg = error?.message || "";
    const safeMessages: Record<string, string> = {
      "Invalid targetUserId": "Invalid user reference.",
      "Password must be": "Password must be between 6 and 72 characters.",
      "Invalid or missing email": "Please provide a valid email address.",
      "Invalid or missing name": "Please provide a valid name.",
      "Invalid or missing companyId": "Company information is missing.",
      "Invalid permissionLevel": "Invalid permission level selected.",
      "Invalid or missing employeeId": "Employee information is missing.",
    };
    const clientMessage = Object.entries(safeMessages).find(([key]) => msg.includes(key))?.[1]
      || "An error occurred. Please try again or contact support.";
    return new Response(
      JSON.stringify({ error: clientMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
