export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      availability: {
        Row: {
          all_projects: boolean | null
          created_at: string
          employee_id: string
          end_time: string
          id: string
          project_id: string | null
          start_time: string
          stop_label: string | null
          stop_number: number | null
        }
        Insert: {
          all_projects?: boolean | null
          created_at?: string
          employee_id: string
          end_time: string
          id?: string
          project_id?: string | null
          start_time: string
          stop_label?: string | null
          stop_number?: number | null
        }
        Update: {
          all_projects?: boolean | null
          created_at?: string
          employee_id?: string
          end_time?: string
          id?: string
          project_id?: string | null
          start_time?: string
          stop_label?: string | null
          stop_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "availability_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          company_type: Database["public"]["Enums"]["company_type"]
          created_at: string
          has_payment_method: boolean
          id: string
          is_guest: boolean
          name: string
          stripe_customer_id: string | null
          subscription_ends_at: string | null
          subscription_status: string | null
          trade: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          company_type: Database["public"]["Enums"]["company_type"]
          created_at?: string
          has_payment_method?: boolean
          id?: string
          is_guest?: boolean
          name: string
          stripe_customer_id?: string | null
          subscription_ends_at?: string | null
          subscription_status?: string | null
          trade?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          company_type?: Database["public"]["Enums"]["company_type"]
          created_at?: string
          has_payment_method?: boolean
          id?: string
          is_guest?: boolean
          name?: string
          stripe_customer_id?: string | null
          subscription_ends_at?: string | null
          subscription_status?: string | null
          trade?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      company_deletion_requests: {
        Row: {
          company_id: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          id: string
          requested_by: string
          status: string
        }
        Insert: {
          company_id: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          requested_by: string
          status?: string
        }
        Update: {
          company_id?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          requested_by?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_deletion_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_join_requests: {
        Row: {
          company_id: string
          created_at: string | null
          id: string
          metadata: Json
          reviewed_by: string | null
          status: string
          updated_at: string | null
          user_email: string
          user_id: string
          user_name: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          id?: string
          metadata?: Json
          reviewed_by?: string | null
          status?: string
          updated_at?: string | null
          user_email: string
          user_id: string
          user_name?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          id?: string
          metadata?: Json
          reviewed_by?: string | null
          status?: string
          updated_at?: string | null
          user_email?: string
          user_id?: string
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_join_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_subscriptions: {
        Row: {
          billing_cycle: string
          company_id: string
          created_at: string
          discount_code_id: string | null
          expires_at: string | null
          id: string
          plan_id: string
          started_at: string
          status: string
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          billing_cycle?: string
          company_id: string
          created_at?: string
          discount_code_id?: string | null
          expires_at?: string | null
          id?: string
          plan_id: string
          started_at?: string
          status?: string
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          billing_cycle?: string
          company_id?: string
          created_at?: string
          discount_code_id?: string | null
          expires_at?: string | null
          id?: string
          plan_id?: string
          started_at?: string
          status?: string
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_subscriptions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_subscriptions_discount_code_id_fkey"
            columns: ["discount_code_id"]
            isOneToOne: false
            referencedRelation: "discount_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          company_name: string | null
          contact_user_id: string | null
          created_at: string
          email: string | null
          id: string
          job_title: string | null
          name: string
          owner_user_id: string
          phone: string | null
          source: string
        }
        Insert: {
          company_name?: string | null
          contact_user_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          job_title?: string | null
          name: string
          owner_user_id: string
          phone?: string | null
          source?: string
        }
        Update: {
          company_name?: string | null
          contact_user_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          job_title?: string | null
          name?: string
          owner_user_id?: string
          phone?: string | null
          source?: string
        }
        Relationships: []
      }
      contractor_connection_project_assignments: {
        Row: {
          connection_id: string
          created_at: string
          created_by: string | null
          id: string
          main_company_id: string
          project_id: string
          shared: boolean
          sub_company_id: string
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          main_company_id: string
          project_id: string
          shared?: boolean
          sub_company_id: string
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          main_company_id?: string
          project_id?: string
          shared?: boolean
          sub_company_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contractor_connection_project_assignments_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "contractor_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_connection_project_assignments_main_company_id_fkey"
            columns: ["main_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_connection_project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_connection_project_assignments_sub_company_id_fkey"
            columns: ["sub_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_connections: {
        Row: {
          accepted_at: string | null
          company_a_id: string
          company_b_id: string
          created_at: string
          id: string
          initiated_by_company_id: string
          initiated_by_user_id: string | null
          main_company_id: string | null
          proposed_main_company_id: string | null
          role_change_request: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          company_a_id: string
          company_b_id: string
          created_at?: string
          id?: string
          initiated_by_company_id: string
          initiated_by_user_id?: string | null
          main_company_id?: string | null
          proposed_main_company_id?: string | null
          role_change_request?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          company_a_id?: string
          company_b_id?: string
          created_at?: string
          id?: string
          initiated_by_company_id?: string
          initiated_by_user_id?: string | null
          main_company_id?: string | null
          proposed_main_company_id?: string | null
          role_change_request?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contractor_connections_company_a_id_fkey"
            columns: ["company_a_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_connections_company_b_id_fkey"
            columns: ["company_b_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_connections_initiated_by_company_id_fkey"
            columns: ["initiated_by_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_connections_main_company_id_fkey"
            columns: ["main_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contractor_connections_proposed_main_company_id_fkey"
            columns: ["proposed_main_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_invites: {
        Row: {
          company_name: string
          created_at: string
          created_by: string | null
          emails: string[]
          id: string
          inviting_company_id: string
          proposed_role: string | null
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          company_name: string
          created_at?: string
          created_by?: string | null
          emails?: string[]
          id?: string
          inviting_company_id: string
          proposed_role?: string | null
          status?: string
          token?: string
          updated_at?: string
        }
        Update: {
          company_name?: string
          created_at?: string
          created_by?: string | null
          emails?: string[]
          id?: string
          inviting_company_id?: string
          proposed_role?: string | null
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contractor_invites_inviting_company_id_fkey"
            columns: ["inviting_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          company_id: string | null
          conversation_id: string
          id: string
          joined_at: string
          role: string
          user_id: string
        }
        Insert: {
          company_id?: string | null
          conversation_id: string
          id?: string
          joined_at?: string
          role?: string
          user_id: string
        }
        Update: {
          company_id?: string | null
          conversation_id?: string
          id?: string
          joined_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          last_message_at: string
          project_id: string | null
          sub_company_id: string | null
          title: string | null
          type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_message_at?: string
          project_id?: string | null
          sub_company_id?: string | null
          title?: string | null
          type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_message_at?: string
          project_id?: string | null
          sub_company_id?: string | null
          title?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      discount_codes: {
        Row: {
          code: string
          created_at: string
          current_uses: number
          description: string | null
          discount_amount: number | null
          discount_percent: number | null
          id: string
          is_active: boolean
          max_uses: number | null
          updated_at: string
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          code: string
          created_at?: string
          current_uses?: number
          description?: string | null
          discount_amount?: number | null
          discount_percent?: number | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          current_uses?: number
          description?: string | null
          discount_amount?: number | null
          discount_percent?: number | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      employee_project_assignments: {
        Row: {
          company_id: string
          created_at: string
          employee_id: string
          id: string
          project_id: string
          receive_notifications: boolean
        }
        Insert: {
          company_id: string
          created_at?: string
          employee_id: string
          id?: string
          project_id: string
          receive_notifications?: boolean
        }
        Update: {
          company_id?: string
          created_at?: string
          employee_id?: string
          id?: string
          project_id?: string
          receive_notifications?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "employee_project_assignments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_project_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          company_id: string
          created_at: string
          email: string
          employee_id: string | null
          id: string
          job_title: string | null
          linked_user_id: string | null
          name: string
          phone: string | null
          profile_picture_url: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          email: string
          employee_id?: string | null
          id?: string
          job_title?: string | null
          linked_user_id?: string | null
          name: string
          phone?: string | null
          profile_picture_url?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          email?: string
          employee_id?: string | null
          id?: string
          job_title?: string | null
          linked_user_id?: string | null
          name?: string
          phone?: string | null
          profile_picture_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      gc_invite_prefills: {
        Row: {
          accepted_at: string | null
          created_at: string
          created_company_id: string | null
          created_project_id: string | null
          created_user_id: string | null
          gc_company_name: string
          id: string
          invite_token: string
          invitee_email: string
          invitee_full_name: string
          invitee_job_title: string | null
          invitee_phone: string | null
          project_address: string | null
          project_name: string
          sub_company_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          created_company_id?: string | null
          created_project_id?: string | null
          created_user_id?: string | null
          gc_company_name: string
          id?: string
          invite_token?: string
          invitee_email: string
          invitee_full_name: string
          invitee_job_title?: string | null
          invitee_phone?: string | null
          project_address?: string | null
          project_name: string
          sub_company_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          created_company_id?: string | null
          created_project_id?: string | null
          created_user_id?: string | null
          gc_company_name?: string
          id?: string
          invite_token?: string
          invitee_email?: string
          invitee_full_name?: string
          invitee_job_title?: string | null
          invitee_phone?: string | null
          project_address?: string | null
          project_name?: string
          sub_company_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gc_invite_prefills_sub_company_id_fkey"
            columns: ["sub_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_gc_links: {
        Row: {
          connection_code: string
          created_at: string
          id: string
          invite_token: string
          sub_company_id: string
        }
        Insert: {
          connection_code?: string
          created_at?: string
          id?: string
          invite_token?: string
          sub_company_id: string
        }
        Update: {
          connection_code?: string
          created_at?: string
          id?: string
          invite_token?: string
          sub_company_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_gc_links_sub_company_id_fkey"
            columns: ["sub_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_project_connections: {
        Row: {
          connected_at: string
          guest_company_id: string
          id: string
          sub_company_id: string
        }
        Insert: {
          connected_at?: string
          guest_company_id: string
          id?: string
          sub_company_id: string
        }
        Update: {
          connected_at?: string
          guest_company_id?: string
          id?: string
          sub_company_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_project_connections_guest_company_id_fkey"
            columns: ["guest_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_project_connections_sub_company_id_fkey"
            columns: ["sub_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      message_attachments: {
        Row: {
          created_at: string
          id: string
          message_id: string
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_id: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reads: {
        Row: {
          conversation_id: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string | null
          conversation_id: string
          created_at: string
          id: string
          kind: string
          metadata: Json
          on_behalf_of_company_id: string | null
          sender_company_id: string | null
          sender_user_id: string | null
        }
        Insert: {
          body?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          kind?: string
          metadata?: Json
          on_behalf_of_company_id?: string | null
          sender_company_id?: string | null
          sender_user_id?: string | null
        }
        Update: {
          body?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          kind?: string
          metadata?: Json
          on_behalf_of_company_id?: string | null
          sender_company_id?: string | null
          sender_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_on_behalf_of_company_id_fkey"
            columns: ["on_behalf_of_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_log: {
        Row: {
          channel: string
          created_at: string
          error_message: string | null
          event_type: string
          id: string
          metadata: Json | null
          recipient_company_id: string | null
          recipient_email: string | null
          status: string
          subject: string | null
        }
        Insert: {
          channel?: string
          created_at?: string
          error_message?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          recipient_company_id?: string | null
          recipient_email?: string | null
          status?: string
          subject?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          error_message?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          recipient_company_id?: string | null
          recipient_email?: string | null
          status?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_log_recipient_company_id_fkey"
            columns: ["recipient_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          channel: string
          company_id: string
          created_at: string
          event_type: string
          id: string
          is_enabled: boolean
          updated_at: string
        }
        Insert: {
          channel?: string
          company_id: string
          created_at?: string
          event_type: string
          id?: string
          is_enabled?: boolean
          updated_at?: string
        }
        Update: {
          channel?: string
          company_id?: string
          created_at?: string
          event_type?: string
          id?: string
          is_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_templates: {
        Row: {
          body_html: string
          channel: string
          created_at: string
          description: string | null
          display_name: string | null
          event_type: string
          id: string
          is_active: boolean
          metadata: Json | null
          placeholder_variables: string[] | null
          subject: string
          updated_at: string
        }
        Insert: {
          body_html?: string
          channel?: string
          created_at?: string
          description?: string | null
          display_name?: string | null
          event_type: string
          id?: string
          is_active?: boolean
          metadata?: Json | null
          placeholder_variables?: string[] | null
          subject?: string
          updated_at?: string
        }
        Update: {
          body_html?: string
          channel?: string
          created_at?: string
          description?: string | null
          display_name?: string | null
          event_type?: string
          id?: string
          is_active?: boolean
          metadata?: Json | null
          placeholder_variables?: string[] | null
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      operators: {
        Row: {
          created_at: string
          created_by: string
          email: string
          full_name: string | null
          id: string
          is_new_user: boolean
          operator_level: string
          previous_company_id: string | null
          previous_role: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          email: string
          full_name?: string | null
          id?: string
          is_new_user?: boolean
          operator_level: string
          previous_company_id?: string | null
          previous_role?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          email?: string
          full_name?: string | null
          id?: string
          is_new_user?: boolean
          operator_level?: string
          previous_company_id?: string | null
          previous_role?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      password_reset_codes: {
        Row: {
          code: string
          created_at: string
          email: string
          expires_at: string
          failed_attempts: number
          id: string
          used: boolean
        }
        Insert: {
          code: string
          created_at?: string
          email: string
          expires_at?: string
          failed_attempts?: number
          id?: string
          used?: boolean
        }
        Update: {
          code?: string
          created_at?: string
          email?: string
          expires_at?: string
          failed_attempts?: number
          id?: string
          used?: boolean
        }
        Relationships: []
      }
      profile_email_sync_queue: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          new_email: string
          processed_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          new_email: string
          processed_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          new_email?: string
          processed_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          company_id: string | null
          created_at: string
          email: string
          force_password_change: boolean
          full_name: string | null
          id: string
          language: string
          phone: string | null
          profile_picture_url: string | null
          role: Database["public"]["Enums"]["user_role"]
          sms_consent: boolean
          sms_consent_at: string | null
          sms_consent_phone: string | null
          tooltip_flags: Json
          tour_seen: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          email: string
          force_password_change?: boolean
          full_name?: string | null
          id?: string
          language?: string
          phone?: string | null
          profile_picture_url?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          sms_consent?: boolean
          sms_consent_at?: string | null
          sms_consent_phone?: string | null
          tooltip_flags?: Json
          tour_seen?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          email?: string
          force_password_change?: boolean
          full_name?: string | null
          id?: string
          language?: string
          phone?: string | null
          profile_picture_url?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          sms_consent?: boolean
          sms_consent_at?: string | null
          sms_consent_phone?: string | null
          tooltip_flags?: Json
          tour_seen?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      project_aliases: {
        Row: {
          address: string | null
          company_id: string
          created_at: string
          id: string
          name: string | null
          project_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          company_id: string
          created_at?: string
          id?: string
          name?: string | null
          project_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          company_id?: string
          created_at?: string
          id?: string
          name?: string | null
          project_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_connections: {
        Row: {
          connected_at: string
          id: string
          project_id: string
          schedule_shared_until: string | null
          share_schedule: boolean
          sub_company_id: string
        }
        Insert: {
          connected_at?: string
          id?: string
          project_id: string
          schedule_shared_until?: string | null
          share_schedule?: boolean
          sub_company_id: string
        }
        Update: {
          connected_at?: string
          id?: string
          project_id?: string
          schedule_shared_until?: string | null
          share_schedule?: boolean
          sub_company_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_connections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_connections_sub_company_id_fkey"
            columns: ["sub_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          address: string | null
          company_id: string | null
          connection_code: string | null
          created_at: string
          id: string
          name: string
          owner_display_name: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          company_id?: string | null
          connection_code?: string | null
          created_at?: string
          id?: string
          name: string
          owner_display_name?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          company_id?: string | null
          connection_code?: string | null
          created_at?: string
          id?: string
          name?: string
          owner_display_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      schedule_requests: {
        Row: {
          acting_company_id: string | null
          cancellation_reason: string | null
          cancelled_by_company_id: string | null
          created_at: string
          description: string | null
          edit_reason: string | null
          edited: boolean | null
          employee_ids: string[] | null
          employee_stops: Json
          end_time: string | null
          guest_gc_company_name: string | null
          guest_gc_project_name: string | null
          id: string
          image_urls: string[] | null
          intermediary_company_id: string | null
          last_edited_by_company_id: string | null
          original_employee_ids: string[] | null
          original_end_time: string | null
          original_start_time: string | null
          project_id: string
          request_group_id: string | null
          requesting_company_id: string
          scheduled_date: string
          scheduled_dates: string[] | null
          silent_assignment: boolean
          start_time: string | null
          status: string | null
          sub_assigned: boolean
          sub_company_id: string
          target_sub_company_id: string | null
          updated_at: string
        }
        Insert: {
          acting_company_id?: string | null
          cancellation_reason?: string | null
          cancelled_by_company_id?: string | null
          created_at?: string
          description?: string | null
          edit_reason?: string | null
          edited?: boolean | null
          employee_ids?: string[] | null
          employee_stops?: Json
          end_time?: string | null
          guest_gc_company_name?: string | null
          guest_gc_project_name?: string | null
          id?: string
          image_urls?: string[] | null
          intermediary_company_id?: string | null
          last_edited_by_company_id?: string | null
          original_employee_ids?: string[] | null
          original_end_time?: string | null
          original_start_time?: string | null
          project_id: string
          request_group_id?: string | null
          requesting_company_id: string
          scheduled_date: string
          scheduled_dates?: string[] | null
          silent_assignment?: boolean
          start_time?: string | null
          status?: string | null
          sub_assigned?: boolean
          sub_company_id: string
          target_sub_company_id?: string | null
          updated_at?: string
        }
        Update: {
          acting_company_id?: string | null
          cancellation_reason?: string | null
          cancelled_by_company_id?: string | null
          created_at?: string
          description?: string | null
          edit_reason?: string | null
          edited?: boolean | null
          employee_ids?: string[] | null
          employee_stops?: Json
          end_time?: string | null
          guest_gc_company_name?: string | null
          guest_gc_project_name?: string | null
          id?: string
          image_urls?: string[] | null
          intermediary_company_id?: string | null
          last_edited_by_company_id?: string | null
          original_employee_ids?: string[] | null
          original_end_time?: string | null
          original_start_time?: string | null
          project_id?: string
          request_group_id?: string | null
          requesting_company_id?: string
          scheduled_date?: string
          scheduled_dates?: string[] | null
          silent_assignment?: boolean
          start_time?: string | null
          status?: string | null
          sub_assigned?: boolean
          sub_company_id?: string
          target_sub_company_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_requests_acting_company_id_fkey"
            columns: ["acting_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_requests_cancelled_by_company_id_fkey"
            columns: ["cancelled_by_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_requests_intermediary_company_id_fkey"
            columns: ["intermediary_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_requests_last_edited_by_company_id_fkey"
            columns: ["last_edited_by_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_requests_requesting_company_id_fkey"
            columns: ["requesting_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_requests_sub_company_id_fkey"
            columns: ["sub_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_requests_target_sub_company_id_fkey"
            columns: ["target_sub_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_inbound_log: {
        Row: {
          body: string | null
          created_at: string
          from_phone: string
          id: string
          matched_keyword: string | null
          received_at: string
          response_event_type: string | null
          response_status: string | null
          to_phone: string | null
          twilio_message_sid: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          from_phone: string
          id?: string
          matched_keyword?: string | null
          received_at?: string
          response_event_type?: string | null
          response_status?: string | null
          to_phone?: string | null
          twilio_message_sid?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          from_phone?: string
          id?: string
          matched_keyword?: string | null
          received_at?: string
          response_event_type?: string | null
          response_status?: string | null
          to_phone?: string | null
          twilio_message_sid?: string | null
        }
        Relationships: []
      }
      subscription_plans: {
        Row: {
          annual_price_per_month: number
          created_at: string
          display_name: string
          features: Json | null
          free_period_months: number | null
          id: string
          is_active: boolean
          last_synced_at: string | null
          max_projects: number
          max_users: number
          monthly_price: number
          name: string
          sort_order: number
          stripe_annual_price_id: string | null
          stripe_monthly_price_id: string | null
          stripe_product_id: string | null
          updated_at: string
        }
        Insert: {
          annual_price_per_month?: number
          created_at?: string
          display_name: string
          features?: Json | null
          free_period_months?: number | null
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          max_projects?: number
          max_users?: number
          monthly_price?: number
          name: string
          sort_order?: number
          stripe_annual_price_id?: string | null
          stripe_monthly_price_id?: string | null
          stripe_product_id?: string | null
          updated_at?: string
        }
        Update: {
          annual_price_per_month?: number
          created_at?: string
          display_name?: string
          features?: Json | null
          free_period_months?: number | null
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          max_projects?: number
          max_users?: number
          monthly_price?: number
          name?: string
          sort_order?: number
          stripe_annual_price_id?: string | null
          stripe_monthly_price_id?: string | null
          stripe_product_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      suppressed_phones: {
        Row: {
          phone: string
          reason: string | null
          suppressed_at: string
        }
        Insert: {
          phone: string
          reason?: string | null
          suppressed_at?: string
        }
        Update: {
          phone?: string
          reason?: string | null
          suppressed_at?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          assigned_company_id: string | null
          color: string | null
          created_at: string
          description: string | null
          end_date: string
          id: string
          name: string
          project_id: string
          shared_with_subs: boolean | null
          start_date: string
          status: string | null
          updated_at: string
        }
        Insert: {
          assigned_company_id?: string | null
          color?: string | null
          created_at?: string
          description?: string | null
          end_date: string
          id?: string
          name: string
          project_id: string
          shared_with_subs?: boolean | null
          start_date: string
          status?: string | null
          updated_at?: string
        }
        Update: {
          assigned_company_id?: string | null
          color?: string | null
          created_at?: string
          description?: string | null
          end_date?: string
          id?: string
          name?: string
          project_id?: string
          shared_with_subs?: boolean | null
          start_date?: string
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_company_id_fkey"
            columns: ["assigned_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_notifications: {
        Row: {
          body: string | null
          conversation_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          project_id: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          conversation_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          project_id?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          conversation_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          project_id?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      user_project_assignments: {
        Row: {
          company_id: string
          created_at: string
          id: string
          project_id: string
          receive_notifications: boolean
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          project_id: string
          receive_notifications?: boolean
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          project_id?: string
          receive_notifications?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_project_assignments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          company_id: string | null
          created_at: string | null
          id: string
          is_company_creator: boolean | null
          permission_level: Database["public"]["Enums"]["permission_level"]
          updated_at: string | null
          user_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          id?: string
          is_company_creator?: boolean | null
          permission_level?: Database["public"]["Enums"]["permission_level"]
          updated_at?: string | null
          user_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          id?: string
          is_company_creator?: boolean | null
          permission_level?: Database["public"]["Enums"]["permission_level"]
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_company_join_request: {
        Args: {
          p_default_permission?: Database["public"]["Enums"]["permission_level"]
          p_request_id: string
        }
        Returns: Json
      }
      assign_guest_company_users_to_project: {
        Args: { p_guest_company_id: string; p_project_id: string }
        Returns: undefined
      }
      can_assign_role: {
        Args: {
          target_company_id: string
          target_permission: Database["public"]["Enums"]["permission_level"]
        }
        Returns: boolean
      }
      can_manage_projects: { Args: never; Returns: boolean }
      can_post_in_project_conversation: {
        Args: { p_conv_id: string }
        Returns: boolean
      }
      can_view_project: { Args: { project_id: string }; Returns: boolean }
      check_user_never_logged_in: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      contact_eligible_users: {
        Args: { p_company_id: string }
        Returns: {
          company_name: string
          email: string
          full_name: string
          job_title: string
          phone: string
          user_id: string
        }[]
      }
      create_contractor_connection_request: {
        Args: {
          p_acting_company_id?: string
          p_other_company_id: string
          p_proposed_role: string
        }
        Returns: string
      }
      create_group_conversation: {
        Args: { p_title: string; p_user_ids: string[] }
        Returns: string
      }
      create_guest_gc_account: {
        Args: {
          p_company_address: string
          p_company_name: string
          p_project_address: string
          p_project_name: string
        }
        Returns: {
          created_company_id: string
          created_project_id: string
        }[]
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_company_usage: {
        Args: { p_company_id: string }
        Returns: {
          employee_count: number
          max_projects: number
          max_users: number
          plan_display_name: string
          project_count: number
        }[]
      }
      get_contractor_connection_project_links: {
        Args: { p_acting_company_id?: string }
        Returns: {
          owner_company_id: string
          project_id: string
          sub_company_id: string
        }[]
      }
      get_employee_cross_gc_bookings: {
        Args: { p_company_id: string; p_dates: string[] }
        Returns: {
          booking_date: string
          employee_id: string
        }[]
      }
      get_or_create_dm_conversation: {
        Args: { p_other_user_id: string }
        Returns: string
      }
      get_or_create_dm_conversation_between: {
        Args: { p_recipient_user_id: string; p_sender_user_id: string }
        Returns: string
      }
      get_or_create_project_conversation: {
        Args: { p_project_id: string }
        Returns: string
      }
      get_or_create_project_sub_conversation: {
        Args: { p_project_id: string; p_sub_company_id: string }
        Returns: string
      }
      get_primary_account_holder_for_company: {
        Args: { p_company_id: string }
        Returns: {
          company_id: string
          company_name: string
          company_type: Database["public"]["Enums"]["company_type"]
          email: string
          full_name: string
          permission_level: Database["public"]["Enums"]["permission_level"]
          profile_id: string
          user_id: string
        }[]
      }
      get_project_by_connection_code: {
        Args: { p_code: string }
        Returns: {
          id: string
          name: string
        }[]
      }
      get_project_notification_recipients: {
        Args: { p_company_id: string; p_project_id: string }
        Returns: {
          email: string
          phone: string
        }[]
      }
      get_project_notification_user_ids: {
        Args: { p_company_id: string; p_project_id: string }
        Returns: {
          user_id: string
        }[]
      }
      get_schedulable_employee_ids: {
        Args: { p_company_id: string }
        Returns: {
          employee_id: string
        }[]
      }
      get_scheduled_personnel_recipients: {
        Args: { p_employee_ids: string[] }
        Returns: {
          email: string
          phone: string
        }[]
      }
      get_scheduled_personnel_user_ids: {
        Args: { p_employee_ids: string[] }
        Returns: {
          user_id: string
        }[]
      }
      get_user_company_id: { Args: never; Returns: string }
      get_user_permission_level: {
        Args: never
        Returns: Database["public"]["Enums"]["permission_level"]
      }
      has_level1_or_higher: { Args: never; Returns: boolean }
      has_partial_or_higher: { Args: never; Returns: boolean }
      has_permission_level: {
        Args: {
          p_level: Database["public"]["Enums"]["permission_level"]
          p_user_id: string
        }
        Returns: boolean
      }
      is_account_holder: { Args: { p_company_id: string }; Returns: boolean }
      is_connected_to_project: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      is_conversation_participant: {
        Args: { p_conv_id: string }
        Returns: boolean
      }
      is_moa: { Args: never; Returns: boolean }
      is_omo: { Args: never; Returns: boolean }
      is_on_contractor_connection: {
        Args: { p_connection_id: string }
        Returns: boolean
      }
      link_company_contacts: {
        Args: { p_company_a: string; p_company_b: string }
        Returns: undefined
      }
      link_contractor_connection_projects: {
        Args: {
          p_acting_company_id?: string
          p_code: string
          p_connection_id: string
        }
        Returns: Json
      }
      list_company_contact_candidates: {
        Args: { p_acting_company_id?: string; p_company_id: string }
        Returns: {
          email: string
          full_name: string
          job_title: string
          user_id: string
        }[]
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      owns_project: { Args: { p_project_id: string }; Returns: boolean }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      request_company_deletion: {
        Args: { p_company_id?: string; p_target_user_id?: string }
        Returns: {
          already_pending: boolean
          company_id: string
          request_id: string
        }[]
      }
      request_or_confirm_role_swap:
        | {
            Args: {
              p_connection_id: string
              p_proposed_main_company_id: string
            }
            Returns: string
          }
        | {
            Args: {
              p_acting_company_id?: string
              p_connection_id: string
              p_proposed_main_company_id: string
            }
            Returns: string
          }
      resolve_acting_company: {
        Args: { p_acting_company_id: string }
        Returns: string
      }
      resolve_project_display: {
        Args: { p_company_id: string; p_project_id: string }
        Returns: {
          address: string
          name: string
        }[]
      }
      respond_contractor_connection_request: {
        Args: {
          p_accept: boolean
          p_acting_company_id?: string
          p_confirm_main_company_id?: string
          p_connection_id: string
        }
        Returns: undefined
      }
      search_companies_for_onboarding: {
        Args: { search_term?: string }
        Returns: {
          company_type: Database["public"]["Enums"]["company_type"]
          id: string
          name: string
        }[]
      }
      search_ssaa_users: {
        Args: { p_query: string }
        Returns: {
          company_id: string
          company_name: string
          email: string
          full_name: string
          phone: string
          user_id: string
        }[]
      }
      search_sub_companies_for_connection: {
        Args: { p_acting_company_id?: string; p_query?: string }
        Returns: {
          address: string
          id: string
          is_guest: boolean
          name: string
          trade: string
        }[]
      }
      service_role_update_profile_for_operator: {
        Args: {
          p_company_id?: string
          p_force_password_change?: boolean
          p_full_name?: string
          p_role: string
          p_user_id: string
        }
        Returns: undefined
      }
      set_contractor_connection_project:
        | {
            Args: {
              p_connection_id: string
              p_project_id: string
              p_shared: boolean
            }
            Returns: string
          }
        | {
            Args: {
              p_acting_company_id?: string
              p_connection_id: string
              p_project_id: string
              p_shared: boolean
            }
            Returns: string
          }
      sync_company_contacts: {
        Args: { p_company_id: string }
        Returns: undefined
      }
      sync_contacts_for_company_projects: {
        Args: { p_company_id: string }
        Returns: undefined
      }
      sync_contacts_for_project: {
        Args: { p_project_id: string }
        Returns: undefined
      }
      sync_project_conversation_participants: {
        Args: { p_project_id: string }
        Returns: undefined
      }
      sync_project_cross_company_contacts: {
        Args: { p_project_id: string }
        Returns: undefined
      }
      sync_project_sub_conversation_participants: {
        Args: { p_conv_id: string }
        Returns: undefined
      }
      unset_contractor_connection_project: {
        Args: {
          p_acting_company_id?: string
          p_connection_id: string
          p_project_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      company_type: "gc" | "sub"
      permission_level:
        | "standard"
        | "partial"
        | "full"
        | "account_holder"
        | "basic"
        | "level_1"
      user_role:
        | "moa"
        | "admin"
        | "project_manager"
        | "superintendent"
        | "worker"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      company_type: ["gc", "sub"],
      permission_level: [
        "standard",
        "partial",
        "full",
        "account_holder",
        "basic",
        "level_1",
      ],
      user_role: [
        "moa",
        "admin",
        "project_manager",
        "superintendent",
        "worker",
      ],
    },
  },
} as const
