import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate the caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAuth = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { imageBase64, mimeType } = await req.json();

    // Input validation
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: 'Image data is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Limit base64 size to ~10MB
    if (imageBase64.length > 14_000_000) {
      return new Response(
        JSON.stringify({ success: false, error: 'Image too large (max 10MB)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
    const safeMimeType = allowedMimeTypes.includes(mimeType) ? mimeType : 'image/png';

    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'AI API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const prompt = `You are a construction schedule parser. Analyze the uploaded schedule image (typically a Microsoft Project, Primavera, or similar Gantt chart) and extract ALL tasks/activities from it.

CRITICAL DATE PARSING RULES — read carefully, this is the most error-prone part:

1. The schedule table typically has these columns: Task Name, Duration, Start, Finish, Predecessors. Read EACH ROW INDEPENDENTLY. Never copy a date from the row above — every row has its own Start and Finish cell, and they almost always differ from the previous row.

2. The default date format in these schedules is US format: M/D/YY or M/D/YYYY (month first, then day, then year). For example:
   - "2/23/26" means February 23, 2026 (NOT March 2, 2026, NOT February 26, 2023)
   - "3/12/26" means March 12, 2026
   - "5/14/26" means May 14, 2026
   When in doubt, the first number is the MONTH (1-12) and the second number is the DAY (1-31).

3. Two-digit year handling: '00–'49 → 2000–2049, '50–'99 → 1950–1999. Most modern construction schedules use 20XX.

4. Use the Gantt timeline header as an anchor. Headers like "Feb 16, '26", "Feb 23, '26", "Mar 2, '26" tell you the year and approximate month range. Reject any parsed date that falls outside this visible window unless the table clearly spans multiple years.

5. CROSS-VALIDATE every row against the Duration column. The number of calendar days from start_date to end_date inclusive should roughly match the Duration value (e.g., Duration "5 days" with Start 2/23/26 should give Finish 2/27/26 — 5 days inclusive). If your parsed Start and Finish don't match the Duration, RE-READ the Start and Finish cells before emitting that row.

6. For milestones (Duration "0 days" or shown with a diamond ◆), set start_date = end_date.

7. Output every date strictly as YYYY-MM-DD (zero-padded month and day).

For each task, extract:
- name: The task/activity name exactly as shown
- start_date: Start date in YYYY-MM-DD format (follow rules above)
- end_date: End/finish date in YYYY-MM-DD format (follow rules above)
- status: "not_started" (default for all tasks)
- trade: Classify each task into a construction trade based on the task name. Use one of these categories: Drywall (includes demo, framing, layout, ceiling grid, hanging, taping, finishing), Electrical (includes rough-in, fixtures, panels, wiring), Plumbing (includes piping, fixtures, water heater), HVAC (includes ductwork, units, controls, insulation), Flooring (includes tile, carpet, VCT, hardwood, polishing), Sprinkler (includes fire protection, standpipe), Security (includes fire alarm, access control, cameras, low voltage), Masonry (includes brick, block, CMU, stone), Structural Steel (includes steel erection, welding, decking), Painting (includes prime, paint, stain, wallcovering), Concrete (includes footings, slabs, foundations, flatwork), Roofing (includes membrane, flashing, insulation), Glazing (includes windows, curtain wall, storefront), Millwork (includes cabinets, countertops, trim, doors), Insulation (includes batt, spray foam, firestopping), Earthwork (includes excavation, grading, backfill, utilities), General (for tasks that don't fit other categories like mobilization, cleanup, punchlist, inspections)
- color_from_image: If you can see colored Gantt bars or color-coded rows in the schedule image, extract the hex color (e.g. "#FF0000") of the bar for this task. If no color is visible, omit this field.

Important rules:
- Extract EVERY row/task visible in the schedule
- Do NOT skip any tasks
- Return ONLY valid JSON, no markdown formatting

Return a JSON object with this exact structure:
{
  "tasks": [
    {
      "name": "Task Name",
      "start_date": "2026-02-16",
      "end_date": "2026-02-20",
      "status": "not_started",
      "trade": "Electrical",
      "color_from_image": "#FF0000"
    }
  ]
}`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${safeMimeType};base64,${imageBase64}`
                }
              }
            ]
          }
        ],
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('AI API error:', errorData);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to analyze schedule image' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    let parsed;
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error('Failed to parse AI response:', content);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to parse schedule data from image' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, data: parsed }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error parsing schedule:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
