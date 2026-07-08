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
      admin_audit_log: {
        Row: {
          action: string
          admin_id: string
          created_at: string
          details: Json | null
          id: string
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string
          details?: Json | null
          id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string
          details?: Json | null
          id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      admin_user_notes: {
        Row: {
          admin_id: string
          category: string
          created_at: string
          id: string
          note: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_id: string
          category?: string
          created_at?: string
          id?: string
          note: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_id?: string
          category?: string
          created_at?: string
          id?: string
          note?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          created_at: string
          event: string
          id: string
          platform: string
          properties: Json
          referrer: string | null
          url: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event: string
          id?: string
          platform?: string
          properties?: Json
          referrer?: string | null
          url?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event?: string
          id?: string
          platform?: string
          properties?: Json
          referrer?: string | null
          url?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      application_rate_log: {
        Row: {
          applicant_id: string
          created_at: string
          id: number
        }
        Insert: {
          applicant_id: string
          created_at?: string
          id?: number
        }
        Update: {
          applicant_id?: string
          created_at?: string
          id?: number
        }
        Relationships: []
      }
      applications: {
        Row: {
          attachment_urls: string[] | null
          counter_price: number | null
          created_at: string
          helper_id: string
          id: string
          job_id: string
          message: string | null
          negotiation_status: string
          offer_message: string | null
          poster_viewed_at: string | null
          proposed_price: number | null
          proposed_rate: number | null
          stake_amount: number | null
          stake_status: string | null
          status: Database["public"]["Enums"]["application_status"]
          updated_at: string
        }
        Insert: {
          attachment_urls?: string[] | null
          counter_price?: number | null
          created_at?: string
          helper_id: string
          id?: string
          job_id: string
          message?: string | null
          negotiation_status?: string
          offer_message?: string | null
          poster_viewed_at?: string | null
          proposed_price?: number | null
          proposed_rate?: number | null
          stake_amount?: number | null
          stake_status?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
        }
        Update: {
          attachment_urls?: string[] | null
          counter_price?: number | null
          created_at?: string
          helper_id?: string
          id?: string
          job_id?: string
          message?: string | null
          negotiation_status?: string
          offer_message?: string | null
          poster_viewed_at?: string | null
          proposed_price?: number | null
          proposed_rate?: number | null
          stake_amount?: number | null
          stake_status?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_dismissals: {
        Row: {
          broadcast_id: string
          dismissed_at: string
          id: string
          user_id: string
        }
        Insert: {
          broadcast_id: string
          dismissed_at?: string
          id?: string
          user_id: string
        }
        Update: {
          broadcast_id?: string
          dismissed_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_dismissals_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcast_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_messages: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string
          id: string
          message: string
          pending_push_fan_out_at: string | null
          push_fanned_out_at: string | null
          starts_at: string
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          message: string
          pending_push_fan_out_at?: string | null
          push_fanned_out_at?: string | null
          starts_at?: string
          title: string
          type?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          message?: string
          pending_push_fan_out_at?: string | null
          push_fanned_out_at?: string | null
          starts_at?: string
          title?: string
          type?: string
        }
        Relationships: []
      }
      business_api_keys: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          key_hash: string
          key_last4: string | null
          last_used_at: string | null
          name: string
          revoked_at: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash: string
          key_last4?: string | null
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash?: string
          key_last4?: string | null
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_api_keys_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_job_templates: {
        Row: {
          active: boolean
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          last_run_at: string | null
          name: string
          next_run_at: string | null
          schedule_cron: string
          schedule_label: string | null
          template_payload: Json
          updated_at: string
        }
        Insert: {
          active?: boolean
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_run_at?: string | null
          name: string
          next_run_at?: string | null
          schedule_cron: string
          schedule_label?: string | null
          template_payload?: Json
          updated_at?: string
        }
        Update: {
          active?: boolean
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_run_at?: string | null
          name?: string
          next_run_at?: string | null
          schedule_cron?: string
          schedule_label?: string | null
          template_payload?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_job_templates_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_members: {
        Row: {
          business_id: string
          created_at: string
          extended_role: string | null
          id: string
          invited_at: string
          invited_by: string | null
          invited_email: string | null
          joined_at: string | null
          role: Database["public"]["Enums"]["business_member_role"]
          status: Database["public"]["Enums"]["business_member_status"]
          user_id: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          extended_role?: string | null
          id?: string
          invited_at?: string
          invited_by?: string | null
          invited_email?: string | null
          joined_at?: string | null
          role?: Database["public"]["Enums"]["business_member_role"]
          status?: Database["public"]["Enums"]["business_member_status"]
          user_id?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          extended_role?: string | null
          id?: string
          invited_at?: string
          invited_by?: string | null
          invited_email?: string | null
          joined_at?: string | null
          role?: Database["public"]["Enums"]["business_member_role"]
          status?: Database["public"]["Enums"]["business_member_status"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_members_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_webhooks: {
        Row: {
          active: boolean
          business_id: string
          created_at: string
          events: string[]
          id: string
          last_delivery_at: string | null
          last_delivery_status: string | null
          secret: string
          url: string
        }
        Insert: {
          active?: boolean
          business_id: string
          created_at?: string
          events?: string[]
          id?: string
          last_delivery_at?: string | null
          last_delivery_status?: string | null
          secret: string
          url: string
        }
        Update: {
          active?: boolean
          business_id?: string
          created_at?: string
          events?: string[]
          id?: string
          last_delivery_at?: string | null
          last_delivery_status?: string | null
          secret?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_webhooks_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          billing_mode: string
          created_at: string
          default_payment_method_id: string | null
          id: string
          monthly_budget: number | null
          monthly_budget_alert_at: number | null
          name: string
          owner_id: string
          report_cadence: string
          report_recipients: string[]
          require_2fa: boolean
          require_approval_above: number | null
          seat_subscription_current_period_end: string | null
          seat_subscription_id: string | null
          seat_subscription_status: string | null
          seat_tier: string
          updated_at: string
          verification_document_type: string | null
          verification_document_url: string | null
          verification_rejection_reason: string | null
          verification_reviewed_at: string | null
          verification_reviewed_by: string | null
          verification_status: string
        }
        Insert: {
          billing_mode?: string
          created_at?: string
          default_payment_method_id?: string | null
          id?: string
          monthly_budget?: number | null
          monthly_budget_alert_at?: number | null
          name: string
          owner_id: string
          report_cadence?: string
          report_recipients?: string[]
          require_2fa?: boolean
          require_approval_above?: number | null
          seat_subscription_current_period_end?: string | null
          seat_subscription_id?: string | null
          seat_subscription_status?: string | null
          seat_tier?: string
          updated_at?: string
          verification_document_type?: string | null
          verification_document_url?: string | null
          verification_rejection_reason?: string | null
          verification_reviewed_at?: string | null
          verification_reviewed_by?: string | null
          verification_status?: string
        }
        Update: {
          billing_mode?: string
          created_at?: string
          default_payment_method_id?: string | null
          id?: string
          monthly_budget?: number | null
          monthly_budget_alert_at?: number | null
          name?: string
          owner_id?: string
          report_cadence?: string
          report_recipients?: string[]
          require_2fa?: boolean
          require_approval_above?: number | null
          seat_subscription_current_period_end?: string | null
          seat_subscription_id?: string | null
          seat_subscription_status?: string | null
          seat_tier?: string
          updated_at?: string
          verification_document_type?: string | null
          verification_document_url?: string | null
          verification_rejection_reason?: string | null
          verification_reviewed_at?: string | null
          verification_reviewed_by?: string | null
          verification_status?: string
        }
        Relationships: []
      }
      care_relationships: {
        Row: {
          care_recipient_id: string
          caregiver_id: string
          created_at: string
          id: string
          invite_token: string | null
          invite_token_expires_at: string | null
          permissions: string[]
          relationship: string
          status: string
        }
        Insert: {
          care_recipient_id: string
          caregiver_id: string
          created_at?: string
          id?: string
          invite_token?: string | null
          invite_token_expires_at?: string | null
          permissions?: string[]
          relationship: string
          status?: string
        }
        Update: {
          care_recipient_id?: string
          caregiver_id?: string
          created_at?: string
          id?: string
          invite_token?: string | null
          invite_token_expires_at?: string | null
          permissions?: string[]
          relationship?: string
          status?: string
        }
        Relationships: []
      }
      community_post_likes: {
        Row: {
          post_id: string
          user_id: string
        }
        Insert: {
          post_id: string
          user_id: string
        }
        Update: {
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      community_posts: {
        Row: {
          after_photo_url: string | null
          author_id: string
          before_photo_url: string | null
          body: string | null
          category: string | null
          created_at: string
          id: string
          is_approved: boolean
          job_id: string | null
          like_count: number
          parish: string | null
          photos: string[] | null
          post_type: string
          title: string | null
        }
        Insert: {
          after_photo_url?: string | null
          author_id: string
          before_photo_url?: string | null
          body?: string | null
          category?: string | null
          created_at?: string
          id?: string
          is_approved?: boolean
          job_id?: string | null
          like_count?: number
          parish?: string | null
          photos?: string[] | null
          post_type: string
          title?: string | null
        }
        Update: {
          after_photo_url?: string | null
          author_id?: string
          before_photo_url?: string | null
          body?: string | null
          category?: string | null
          created_at?: string
          id?: string
          is_approved?: boolean
          job_id?: string | null
          like_count?: number
          parish?: string | null
          photos?: string[] | null
          post_type?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_posts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_posts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_posts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      disputes: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_text: string | null
          evidence_urls: string[]
          id: string
          job_id: string
          opener_id: string
          payout_split: Json | null
          reason: string
          status: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_text?: string | null
          evidence_urls?: string[]
          id?: string
          job_id: string
          opener_id: string
          payout_split?: Json | null
          reason: string
          status?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_text?: string | null
          evidence_urls?: string[]
          id?: string
          job_id?: string
          opener_id?: string
          payout_split?: Json | null
          reason?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "disputes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
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
      email_tracking: {
        Row: {
          created_at: string
          email_type: string
          event_type: string
          id: string
          ip_address: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          email_type: string
          event_type?: string
          id?: string
          ip_address?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          email_type?: string
          event_type?: string
          id?: string
          ip_address?: string | null
          user_agent?: string | null
          user_id?: string
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
      error_logs: {
        Row: {
          context: Json
          created_at: string
          id: string
          message: string
          severity: string
          stack: string | null
          tags: Json
          url: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          context?: Json
          created_at?: string
          id?: string
          message: string
          severity?: string
          stack?: string | null
          tags?: Json
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          context?: Json
          created_at?: string
          id?: string
          message?: string
          severity?: string
          stack?: string | null
          tags?: Json
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      evacuation_pets: {
        Row: {
          created_at: string
          destination_address: string | null
          helper_id: string | null
          id: string
          notes: string | null
          owner_id: string
          pet_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          destination_address?: string | null
          helper_id?: string | null
          id?: string
          notes?: string | null
          owner_id: string
          pet_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          destination_address?: string | null
          helper_id?: string | null
          id?: string
          notes?: string | null
          owner_id?: string
          pet_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evacuation_pets_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pet_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      favorite_helpers: {
        Row: {
          business_account_id: string | null
          created_at: string | null
          customer_id: string
          helper_id: string
          id: string
          private_note: string | null
        }
        Insert: {
          business_account_id?: string | null
          created_at?: string | null
          customer_id: string
          helper_id: string
          id?: string
          private_note?: string | null
        }
        Update: {
          business_account_id?: string | null
          created_at?: string | null
          customer_id?: string
          helper_id?: string
          id?: string
          private_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "favorite_helpers_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      fraud_flags: {
        Row: {
          created_at: string
          details: string | null
          flag_type: string
          id: string
          job_id: string | null
          resolved: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          flag_type: string
          id?: string
          job_id?: string | null
          resolved?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          details?: string | null
          flag_type?: string
          id?: string
          job_id?: string | null
          resolved?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fraud_flags_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fraud_flags_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fraud_flags_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      group_job_helpers: {
        Row: {
          helper_id: string
          id: string
          job_id: string
          joined_at: string | null
          status: string
        }
        Insert: {
          helper_id: string
          id?: string
          job_id: string
          joined_at?: string | null
          status?: string
        }
        Update: {
          helper_id?: string
          id?: string
          job_id?: string
          joined_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_job_helpers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_job_helpers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_job_helpers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      helper_availability: {
        Row: {
          created_at: string | null
          day_of_week: number | null
          end_time: string | null
          helper_id: string
          id: string
          is_available: boolean | null
          specific_date: string | null
          start_time: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          day_of_week?: number | null
          end_time?: string | null
          helper_id: string
          id?: string
          is_available?: boolean | null
          specific_date?: string | null
          start_time?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          day_of_week?: number | null
          end_time?: string | null
          helper_id?: string
          id?: string
          is_available?: boolean | null
          specific_date?: string | null
          start_time?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      helper_circle_members: {
        Row: {
          added_at: string | null
          category: string | null
          circle_id: string
          helper_id: string
          id: string
          nickname: string | null
        }
        Insert: {
          added_at?: string | null
          category?: string | null
          circle_id: string
          helper_id: string
          id?: string
          nickname?: string | null
        }
        Update: {
          added_at?: string | null
          category?: string | null
          circle_id?: string
          helper_id?: string
          id?: string
          nickname?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "helper_circle_members_circle_id_fkey"
            columns: ["circle_id"]
            isOneToOne: false
            referencedRelation: "helper_circles"
            referencedColumns: ["id"]
          },
        ]
      }
      helper_circles: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          owner_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          owner_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          owner_id?: string
        }
        Relationships: []
      }
      helper_credentials: {
        Row: {
          created_at: string
          credential_type: string
          document_url: string | null
          expiration_date: string | null
          id: string
          issuing_authority: string | null
          license_number: string | null
          license_state: string | null
          rejection_reason: string | null
          status: string
          trade_category: string | null
          updated_at: string
          user_id: string
          vendor_check_id: string | null
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          credential_type: string
          document_url?: string | null
          expiration_date?: string | null
          id?: string
          issuing_authority?: string | null
          license_number?: string | null
          license_state?: string | null
          rejection_reason?: string | null
          status?: string
          trade_category?: string | null
          updated_at?: string
          user_id: string
          vendor_check_id?: string | null
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          credential_type?: string
          document_url?: string | null
          expiration_date?: string | null
          id?: string
          issuing_authority?: string | null
          license_number?: string | null
          license_state?: string | null
          rejection_reason?: string | null
          status?: string
          trade_category?: string | null
          updated_at?: string
          user_id?: string
          vendor_check_id?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      helper_late_cancellations: {
        Row: {
          cancelled_at: string
          helper_id: string
          id: string
          job_id: string
          minutes_before_start: number | null
          reason: string | null
        }
        Insert: {
          cancelled_at?: string
          helper_id: string
          id?: string
          job_id: string
          minutes_before_start?: number | null
          reason?: string | null
        }
        Update: {
          cancelled_at?: string
          helper_id?: string
          id?: string
          job_id?: string
          minutes_before_start?: number | null
          reason?: string | null
        }
        Relationships: []
      }
      helper_preferred_parishes: {
        Row: {
          created_at: string
          helper_id: string
          id: string
          parish: string
        }
        Insert: {
          created_at?: string
          helper_id: string
          id?: string
          parish: string
        }
        Update: {
          created_at?: string
          helper_id?: string
          id?: string
          parish?: string
        }
        Relationships: []
      }
      helper_shadowbans: {
        Row: {
          created_by: string
          expires_at: string
          helper_id: string
          id: string
          reason: string
          started_at: string
        }
        Insert: {
          created_by?: string
          expires_at: string
          helper_id: string
          id?: string
          reason: string
          started_at?: string
        }
        Update: {
          created_by?: string
          expires_at?: string
          helper_id?: string
          id?: string
          reason?: string
          started_at?: string
        }
        Relationships: []
      }
      helper_skills: {
        Row: {
          category: string | null
          created_at: string
          endorsement_count: number
          id: string
          skill: string
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          endorsement_count?: number
          id?: string
          skill: string
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          endorsement_count?: number
          id?: string
          skill?: string
          user_id?: string
        }
        Relationships: []
      }
      helper_verifications: {
        Row: {
          changed_at: string
          changed_by: string | null
          field: string
          id: string
          new_value: string | null
          old_value: string | null
          user_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          field: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          user_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          field?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          user_id?: string
        }
        Relationships: []
      }
      helper_w9_records: {
        Row: {
          business_id: string | null
          helper_id: string
          id: string
          ip: string | null
          job_id: string | null
          signed_at: string
          typed_signature: string
        }
        Insert: {
          business_id?: string | null
          helper_id: string
          id?: string
          ip?: string | null
          job_id?: string | null
          signed_at?: string
          typed_signature: string
        }
        Update: {
          business_id?: string | null
          helper_id?: string
          id?: string
          ip?: string | null
          job_id?: string | null
          signed_at?: string
          typed_signature?: string
        }
        Relationships: [
          {
            foreignKeyName: "helper_w9_records_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "helper_w9_records_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "helper_w9_records_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "helper_w9_records_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      home_maintenance_reminders: {
        Row: {
          category: string
          created_at: string
          id: string
          is_active: boolean
          last_completed_date: string | null
          last_job_id: string | null
          next_reminder_date: string | null
          reminder_interval_days: number
          user_id: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_completed_date?: string | null
          last_job_id?: string | null
          next_reminder_date?: string | null
          reminder_interval_days?: number
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_completed_date?: string | null
          last_job_id?: string | null
          next_reminder_date?: string | null
          reminder_interval_days?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "home_maintenance_reminders_last_job_id_fkey"
            columns: ["last_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_maintenance_reminders_last_job_id_fkey"
            columns: ["last_job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_maintenance_reminders_last_job_id_fkey"
            columns: ["last_job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      instant_payouts: {
        Row: {
          created_at: string
          error_message: string | null
          fee_amount: number
          gross_amount: number
          helper_id: string
          id: string
          net_amount: number
          status: string
          stripe_payout_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          fee_amount: number
          gross_amount: number
          helper_id: string
          id?: string
          net_amount: number
          status?: string
          stripe_payout_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          fee_amount?: number
          gross_amount?: number
          helper_id?: string
          id?: string
          net_amount?: number
          status?: string
          stripe_payout_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      job_boosts: {
        Row: {
          boosted_at: string
          boosted_by: string
          helpers_notified: number | null
          id: string
          job_id: string
        }
        Insert: {
          boosted_at?: string
          boosted_by: string
          helpers_notified?: number | null
          id?: string
          job_id: string
        }
        Update: {
          boosted_at?: string
          boosted_by?: string
          helpers_notified?: number | null
          id?: string
          job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_boosts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_boosts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_boosts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      job_checkins: {
        Row: {
          created_at: string | null
          id: string
          job_id: string
          latitude: number | null
          longitude: number | null
          note: string | null
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          job_id: string
          latitude?: number | null
          longitude?: number | null
          note?: string | null
          type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          job_id?: string
          latitude?: number | null
          longitude?: number | null
          note?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_checkins_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_checkins_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_checkins_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      job_disputes: {
        Row: {
          created_at: string
          description: string | null
          id: string
          job_id: string
          opened_by: string
          photos: string[] | null
          reason: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          job_id: string
          opened_by: string
          photos?: string[] | null
          reason: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          job_id?: string
          opened_by?: string
          photos?: string[] | null
          reason?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_disputes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_disputes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_disputes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      job_revisions: {
        Row: {
          created_at: string
          description: string
          helper_response: string | null
          id: string
          job_id: string
          photos: string[] | null
          requested_by: string
          resolved_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          description: string
          helper_response?: string | null
          id?: string
          job_id: string
          photos?: string[] | null
          requested_by: string
          resolved_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          description?: string
          helper_response?: string | null
          id?: string
          job_id?: string
          photos?: string[] | null
          requested_by?: string
          resolved_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_revisions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_revisions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_revisions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      job_tracking: {
        Row: {
          created_at: string | null
          eta_minutes: number | null
          helper_id: string
          id: string
          job_id: string
          latitude: number | null
          longitude: number | null
          status: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          eta_minutes?: number | null
          helper_id: string
          id?: string
          job_id: string
          latitude?: number | null
          longitude?: number | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          eta_minutes?: number | null
          helper_id?: string
          id?: string
          job_id?: string
          latitude?: number | null
          longitude?: number | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_tracking_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_tracking_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_tracking_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      job_views: {
        Row: {
          first_viewed_at: string
          id: string
          job_id: string
          viewer_id: string
        }
        Insert: {
          first_viewed_at?: string
          id?: string
          job_id: string
          viewer_id: string
        }
        Update: {
          first_viewed_at?: string
          id?: string
          job_id?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_views_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_views_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_views_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          bid_ceiling: number | null
          bid_deadline: string | null
          bids_sealed: boolean
          boost_auto_extended: boolean
          boost_expires_at: string | null
          boosted_at: string | null
          budget: number
          business_id: string | null
          cancellation_fee: number | null
          cancellation_fee_status: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          category: Database["public"]["Enums"]["job_category"]
          commission_tax_amount: number | null
          created_at: string
          credential_tier: number
          customer_fee_amount: number | null
          customer_id: string
          date_needed: string
          department: string | null
          description: string
          direct_offer_expires_at: string | null
          direct_offer_status: string | null
          dispute_deadline: string | null
          dispute_evidence_urls: string[] | null
          dispute_helper_response: string | null
          dispute_reason: string | null
          dispute_resolved_at: string | null
          dispute_status: string | null
          disputed_at: string | null
          disputed_by: string | null
          estimated_hours: number | null
          expires_at: string | null
          expiring_notif_sent: boolean | null
          flag_reasons: string[] | null
          has_active_dispute: boolean
          helper_arrived_at: string | null
          helper_completed_at: string | null
          helper_confirmed_at: string | null
          helper_fee_percent: number | null
          helper_id: string | null
          helper_on_the_way_at: string | null
          helpers_needed: number | null
          id: string
          instant_book: boolean
          is_auto_created: boolean
          is_flexible_schedule: boolean
          is_group_job: boolean | null
          is_recurring: boolean | null
          is_urgent: boolean | null
          late_cancellation: boolean | null
          latitude: number | null
          location: string
          longitude: number | null
          no_show_alert_sent_at: string | null
          offered_to_helper_id: string | null
          parent_job_id: string | null
          parish: string | null
          payment_confirm_notif_sent: boolean | null
          payment_status: string | null
          payout_scheduled_at: string | null
          photos: string[] | null
          platform_fee_amount: number | null
          platform_fee_percent: number | null
          poster_completed_at: string | null
          poster_confirmed_arrival_at: string | null
          poster_confirmed_at: string | null
          poster_confirmed_working_at: string | null
          pricing_mode: string
          proof_after_urls: string[] | null
          proof_before_urls: string[] | null
          protection_fee: number | null
          protection_opted_in: boolean
          recurrence_end_date: string | null
          recurrence_interval: string | null
          removal_reason: string | null
          removed_at: string | null
          removed_by: string | null
          requires_w9: boolean
          response_deadline: string | null
          review_reminder_sent: boolean
          revision_acceptance_deadline: string | null
          revision_completed_at: string | null
          revision_count: number
          revision_deadline: string | null
          revision_note: string | null
          revision_requested_at: string | null
          sales_tax_amount: number | null
          sales_tax_rate: number | null
          scope_video_thumbnail_url: string | null
          scope_video_url: string | null
          special_requirements: string | null
          start_reminder_sent_at: string | null
          start_time: string | null
          status: Database["public"]["Enums"]["job_status"]
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          title: string
          updated_at: string
          urgent_fee: number | null
          zip_code: string | null
        }
        Insert: {
          bid_ceiling?: number | null
          bid_deadline?: string | null
          bids_sealed?: boolean
          boost_auto_extended?: boolean
          boost_expires_at?: string | null
          boosted_at?: string | null
          budget: number
          business_id?: string | null
          cancellation_fee?: number | null
          cancellation_fee_status?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category?: Database["public"]["Enums"]["job_category"]
          commission_tax_amount?: number | null
          created_at?: string
          credential_tier?: number
          customer_fee_amount?: number | null
          customer_id: string
          date_needed: string
          department?: string | null
          description: string
          direct_offer_expires_at?: string | null
          direct_offer_status?: string | null
          dispute_deadline?: string | null
          dispute_evidence_urls?: string[] | null
          dispute_helper_response?: string | null
          dispute_reason?: string | null
          dispute_resolved_at?: string | null
          dispute_status?: string | null
          disputed_at?: string | null
          disputed_by?: string | null
          estimated_hours?: number | null
          expires_at?: string | null
          expiring_notif_sent?: boolean | null
          flag_reasons?: string[] | null
          has_active_dispute?: boolean
          helper_arrived_at?: string | null
          helper_completed_at?: string | null
          helper_confirmed_at?: string | null
          helper_fee_percent?: number | null
          helper_id?: string | null
          helper_on_the_way_at?: string | null
          helpers_needed?: number | null
          id?: string
          instant_book?: boolean
          is_auto_created?: boolean
          is_flexible_schedule?: boolean
          is_group_job?: boolean | null
          is_recurring?: boolean | null
          is_urgent?: boolean | null
          late_cancellation?: boolean | null
          latitude?: number | null
          location: string
          longitude?: number | null
          no_show_alert_sent_at?: string | null
          offered_to_helper_id?: string | null
          parent_job_id?: string | null
          parish?: string | null
          payment_confirm_notif_sent?: boolean | null
          payment_status?: string | null
          payout_scheduled_at?: string | null
          photos?: string[] | null
          platform_fee_amount?: number | null
          platform_fee_percent?: number | null
          poster_completed_at?: string | null
          poster_confirmed_arrival_at?: string | null
          poster_confirmed_at?: string | null
          poster_confirmed_working_at?: string | null
          pricing_mode?: string
          proof_after_urls?: string[] | null
          proof_before_urls?: string[] | null
          protection_fee?: number | null
          protection_opted_in?: boolean
          recurrence_end_date?: string | null
          recurrence_interval?: string | null
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          requires_w9?: boolean
          response_deadline?: string | null
          review_reminder_sent?: boolean
          revision_acceptance_deadline?: string | null
          revision_completed_at?: string | null
          revision_count?: number
          revision_deadline?: string | null
          revision_note?: string | null
          revision_requested_at?: string | null
          sales_tax_amount?: number | null
          sales_tax_rate?: number | null
          scope_video_thumbnail_url?: string | null
          scope_video_url?: string | null
          special_requirements?: string | null
          start_reminder_sent_at?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          title: string
          updated_at?: string
          urgent_fee?: number | null
          zip_code?: string | null
        }
        Update: {
          bid_ceiling?: number | null
          bid_deadline?: string | null
          bids_sealed?: boolean
          boost_auto_extended?: boolean
          boost_expires_at?: string | null
          boosted_at?: string | null
          budget?: number
          business_id?: string | null
          cancellation_fee?: number | null
          cancellation_fee_status?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category?: Database["public"]["Enums"]["job_category"]
          commission_tax_amount?: number | null
          created_at?: string
          credential_tier?: number
          customer_fee_amount?: number | null
          customer_id?: string
          date_needed?: string
          department?: string | null
          description?: string
          direct_offer_expires_at?: string | null
          direct_offer_status?: string | null
          dispute_deadline?: string | null
          dispute_evidence_urls?: string[] | null
          dispute_helper_response?: string | null
          dispute_reason?: string | null
          dispute_resolved_at?: string | null
          dispute_status?: string | null
          disputed_at?: string | null
          disputed_by?: string | null
          estimated_hours?: number | null
          expires_at?: string | null
          expiring_notif_sent?: boolean | null
          flag_reasons?: string[] | null
          has_active_dispute?: boolean
          helper_arrived_at?: string | null
          helper_completed_at?: string | null
          helper_confirmed_at?: string | null
          helper_fee_percent?: number | null
          helper_id?: string | null
          helper_on_the_way_at?: string | null
          helpers_needed?: number | null
          id?: string
          instant_book?: boolean
          is_auto_created?: boolean
          is_flexible_schedule?: boolean
          is_group_job?: boolean | null
          is_recurring?: boolean | null
          is_urgent?: boolean | null
          late_cancellation?: boolean | null
          latitude?: number | null
          location?: string
          longitude?: number | null
          no_show_alert_sent_at?: string | null
          offered_to_helper_id?: string | null
          parent_job_id?: string | null
          parish?: string | null
          payment_confirm_notif_sent?: boolean | null
          payment_status?: string | null
          payout_scheduled_at?: string | null
          photos?: string[] | null
          platform_fee_amount?: number | null
          platform_fee_percent?: number | null
          poster_completed_at?: string | null
          poster_confirmed_arrival_at?: string | null
          poster_confirmed_at?: string | null
          poster_confirmed_working_at?: string | null
          pricing_mode?: string
          proof_after_urls?: string[] | null
          proof_before_urls?: string[] | null
          protection_fee?: number | null
          protection_opted_in?: boolean
          recurrence_end_date?: string | null
          recurrence_interval?: string | null
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          requires_w9?: boolean
          response_deadline?: string | null
          review_reminder_sent?: boolean
          revision_acceptance_deadline?: string | null
          revision_completed_at?: string | null
          revision_count?: number
          revision_deadline?: string | null
          revision_note?: string | null
          revision_requested_at?: string | null
          sales_tax_amount?: number | null
          sales_tax_rate?: number | null
          scope_video_thumbnail_url?: string | null
          scope_video_url?: string | null
          special_requirements?: string | null
          start_reminder_sent_at?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          title?: string
          updated_at?: string
          urgent_fee?: number | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_acceptances: {
        Row: {
          created_at: string
          id: string
          ip_address: string | null
          marketing_opted_in: boolean
          privacy_version: string
          terms_version: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ip_address?: string | null
          marketing_opted_in?: boolean
          privacy_version: string
          terms_version: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ip_address?: string | null
          marketing_opted_in?: boolean
          privacy_version?: string
          terms_version?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      login_history: {
        Row: {
          created_at: string
          id: string
          ip_address: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ip_address?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ip_address?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      louisiana_zip_parishes: {
        Row: {
          city: string | null
          created_at: string
          parish: string
          zip_code: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          parish: string
          zip_code: string
        }
        Update: {
          city?: string | null
          created_at?: string
          parish?: string
          zip_code?: string
        }
        Relationships: []
      }
      match_digest_queue: {
        Row: {
          created_at: string
          id: string
          job_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_digest_queue_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_digest_queue_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_digest_queue_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachment_duration: number | null
          attachment_mime: string | null
          attachment_size: number | null
          attachment_url: string | null
          content: string
          created_at: string
          flag_reason: string | null
          flagged_hidden: boolean
          id: string
          is_system: boolean
          job_id: string
          read: boolean
          receiver_id: string
          sender_id: string
        }
        Insert: {
          attachment_duration?: number | null
          attachment_mime?: string | null
          attachment_size?: number | null
          attachment_url?: string | null
          content: string
          created_at?: string
          flag_reason?: string | null
          flagged_hidden?: boolean
          id?: string
          is_system?: boolean
          job_id: string
          read?: boolean
          receiver_id: string
          sender_id: string
        }
        Update: {
          attachment_duration?: number | null
          attachment_mime?: string | null
          attachment_size?: number | null
          attachment_url?: string | null
          content?: string
          created_at?: string
          flag_reason?: string | null
          flagged_hidden?: boolean
          id?: string
          is_system?: boolean
          job_id?: string
          read?: boolean
          receiver_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_logs: {
        Row: {
          category: string
          channel: string
          created_at: string
          error_message: string | null
          id: string
          job_id: string | null
          message_id: string | null
          recipient_email: string | null
          status: string
          subject: string | null
          user_id: string
        }
        Insert: {
          category: string
          channel: string
          created_at?: string
          error_message?: string | null
          id?: string
          job_id?: string | null
          message_id?: string | null
          recipient_email?: string | null
          status?: string
          subject?: string | null
          user_id: string
        }
        Update: {
          category?: string
          channel?: string
          created_at?: string
          error_message?: string | null
          id?: string
          job_id?: string | null
          message_id?: string | null
          recipient_email?: string | null
          status?: string
          subject?: string | null
          user_id?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          created_at: string
          email_financial_alerts: boolean
          email_job_applications: boolean
          email_job_updates: boolean
          email_messages: boolean
          email_new_offers: boolean
          email_payments: boolean
          email_promotions: boolean
          email_reviews: boolean
          email_system_alerts: boolean
          email_transit_updates: boolean
          email_work_status: boolean
          financial_alerts: boolean
          id: string
          job_applications: boolean
          job_updates: boolean
          match_digest_mode: boolean
          messages: boolean
          new_offers: boolean
          payments: boolean
          promotions: boolean
          push_enabled: boolean
          quiet_end: string | null
          quiet_start: string | null
          reviews: boolean
          system_alerts: boolean
          transit_updates: boolean
          updated_at: string
          user_id: string
          work_status: boolean
        }
        Insert: {
          created_at?: string
          email_financial_alerts?: boolean
          email_job_applications?: boolean
          email_job_updates?: boolean
          email_messages?: boolean
          email_new_offers?: boolean
          email_payments?: boolean
          email_promotions?: boolean
          email_reviews?: boolean
          email_system_alerts?: boolean
          email_transit_updates?: boolean
          email_work_status?: boolean
          financial_alerts?: boolean
          id?: string
          job_applications?: boolean
          job_updates?: boolean
          match_digest_mode?: boolean
          messages?: boolean
          new_offers?: boolean
          payments?: boolean
          promotions?: boolean
          push_enabled?: boolean
          quiet_end?: string | null
          quiet_start?: string | null
          reviews?: boolean
          system_alerts?: boolean
          transit_updates?: boolean
          updated_at?: string
          user_id: string
          work_status?: boolean
        }
        Update: {
          created_at?: string
          email_financial_alerts?: boolean
          email_job_applications?: boolean
          email_job_updates?: boolean
          email_messages?: boolean
          email_new_offers?: boolean
          email_payments?: boolean
          email_promotions?: boolean
          email_reviews?: boolean
          email_system_alerts?: boolean
          email_transit_updates?: boolean
          email_work_status?: boolean
          financial_alerts?: boolean
          id?: string
          job_applications?: boolean
          job_updates?: boolean
          match_digest_mode?: boolean
          messages?: boolean
          new_offers?: boolean
          payments?: boolean
          promotions?: boolean
          push_enabled?: boolean
          quiet_end?: string | null
          quiet_start?: string | null
          reviews?: boolean
          system_alerts?: boolean
          transit_updates?: boolean
          updated_at?: string
          user_id?: string
          work_status?: boolean
        }
        Relationships: []
      }
      notification_type_pref_map: {
        Row: {
          description: string | null
          pref_column: string | null
          type: string
        }
        Insert: {
          description?: string | null
          pref_column?: string | null
          type: string
        }
        Update: {
          description?: string | null
          pref_column?: string | null
          type?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          link: string | null
          message: string
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          link?: string | null
          message: string
          read?: boolean
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          link?: string | null
          message?: string
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      nps_responses: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          score: number
          triggered_at_jobs_completed: number | null
          user_id: string
          user_role: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          score: number
          triggered_at_jobs_completed?: number | null
          user_id: string
          user_role?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          score?: number
          triggered_at_jobs_completed?: number | null
          user_id?: string
          user_role?: string | null
        }
        Relationships: []
      }
      parish_tax_rates: {
        Row: {
          id: string
          local_rate: number
          parish_name: string
          state_rate: number
          total_rate: number | null
          updated_at: string
        }
        Insert: {
          id?: string
          local_rate?: number
          parish_name: string
          state_rate?: number
          total_rate?: number | null
          updated_at?: string
        }
        Update: {
          id?: string
          local_rate?: number
          parish_name?: string
          state_rate?: number
          total_rate?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      payment_refunds: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          customer_id: string | null
          id: string
          initiated_by_user_id: string | null
          is_partial: boolean
          job_id: string | null
          metadata: Json
          reason: string | null
          source: string
          stripe_payment_intent_id: string | null
          stripe_refund_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          customer_id?: string | null
          id?: string
          initiated_by_user_id?: string | null
          is_partial?: boolean
          job_id?: string | null
          metadata?: Json
          reason?: string | null
          source: string
          stripe_payment_intent_id?: string | null
          stripe_refund_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          customer_id?: string | null
          id?: string
          initiated_by_user_id?: string | null
          is_partial?: boolean
          job_id?: string | null
          metadata?: Json
          reason?: string | null
          source?: string
          stripe_payment_intent_id?: string | null
          stripe_refund_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_refunds_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_refunds_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_refunds_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_transfers: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          failed_at: string | null
          failure_reason: string | null
          helper_id: string
          id: string
          initiated_by: string
          initiated_by_user_id: string | null
          job_id: string
          metadata: Json
          paid_at: string | null
          platform_fee_cents: number
          reversed_at: string | null
          status: string
          stripe_account_id: string
          stripe_transfer_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          failed_at?: string | null
          failure_reason?: string | null
          helper_id: string
          id?: string
          initiated_by?: string
          initiated_by_user_id?: string | null
          job_id: string
          metadata?: Json
          paid_at?: string | null
          platform_fee_cents?: number
          reversed_at?: string | null
          status?: string
          stripe_account_id: string
          stripe_transfer_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          failed_at?: string | null
          failure_reason?: string | null
          helper_id?: string
          id?: string
          initiated_by?: string
          initiated_by_user_id?: string | null
          job_id?: string
          metadata?: Json
          paid_at?: string | null
          platform_fee_cents?: number
          reversed_at?: string | null
          status?: string
          stripe_account_id?: string
          stripe_transfer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_transfers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_transfers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_transfers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      pet_profiles: {
        Row: {
          age_years: number | null
          behavioral_notes: string | null
          breed: string | null
          color_markings: string | null
          created_at: string
          emergency_contact: string | null
          feeding_schedule: string | null
          id: string
          is_evacuation_registered: boolean
          medical_notes: string | null
          microchip_id: string | null
          name: string
          owner_id: string
          photo_url: string | null
          species: string
          updated_at: string
          vet_name: string | null
          vet_phone: string | null
          weight_lbs: number | null
        }
        Insert: {
          age_years?: number | null
          behavioral_notes?: string | null
          breed?: string | null
          color_markings?: string | null
          created_at?: string
          emergency_contact?: string | null
          feeding_schedule?: string | null
          id?: string
          is_evacuation_registered?: boolean
          medical_notes?: string | null
          microchip_id?: string | null
          name: string
          owner_id: string
          photo_url?: string | null
          species: string
          updated_at?: string
          vet_name?: string | null
          vet_phone?: string | null
          weight_lbs?: number | null
        }
        Update: {
          age_years?: number | null
          behavioral_notes?: string | null
          breed?: string | null
          color_markings?: string | null
          created_at?: string
          emergency_contact?: string | null
          feeding_schedule?: string | null
          id?: string
          is_evacuation_registered?: boolean
          medical_notes?: string | null
          microchip_id?: string | null
          name?: string
          owner_id?: string
          photo_url?: string | null
          species?: string
          updated_at?: string
          vet_name?: string | null
          vet_phone?: string | null
          weight_lbs?: number | null
        }
        Relationships: []
      }
      pet_report_cards: {
        Row: {
          ate_well: boolean | null
          created_at: string
          exercise_duration_minutes: number | null
          gps_walk_summary: string | null
          helper_id: string
          id: string
          job_id: string
          mood: string | null
          notes: string | null
          owner_id: string
          pet_id: string
          photos: string[] | null
          potty_breaks: number | null
          report_date: string
        }
        Insert: {
          ate_well?: boolean | null
          created_at?: string
          exercise_duration_minutes?: number | null
          gps_walk_summary?: string | null
          helper_id: string
          id?: string
          job_id: string
          mood?: string | null
          notes?: string | null
          owner_id: string
          pet_id: string
          photos?: string[] | null
          potty_breaks?: number | null
          report_date?: string
        }
        Update: {
          ate_well?: boolean | null
          created_at?: string
          exercise_duration_minutes?: number | null
          gps_walk_summary?: string | null
          helper_id?: string
          id?: string
          job_id?: string
          mood?: string | null
          notes?: string | null
          owner_id?: string
          pet_id?: string
          photos?: string[] | null
          potty_breaks?: number | null
          report_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "pet_report_cards_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pet_report_cards_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pet_report_cards_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pet_report_cards_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pet_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pif_credits: {
        Row: {
          amount: number
          category: string | null
          claim_token: string | null
          created_at: string
          donor_id: string
          expires_at: string | null
          id: string
          job_id: string | null
          message: string | null
          parent_credit_id: string | null
          parish: string | null
          payment_status: string
          recipient_email: string | null
          recipient_id: string | null
          redeemed_at: string | null
          status: string
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
        }
        Insert: {
          amount: number
          category?: string | null
          claim_token?: string | null
          created_at?: string
          donor_id: string
          expires_at?: string | null
          id?: string
          job_id?: string | null
          message?: string | null
          parent_credit_id?: string | null
          parish?: string | null
          payment_status?: string
          recipient_email?: string | null
          recipient_id?: string | null
          redeemed_at?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
        }
        Update: {
          amount?: number
          category?: string | null
          claim_token?: string | null
          created_at?: string
          donor_id?: string
          expires_at?: string | null
          id?: string
          job_id?: string | null
          message?: string | null
          parent_credit_id?: string | null
          parish?: string | null
          payment_status?: string
          recipient_email?: string | null
          recipient_id?: string | null
          redeemed_at?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pif_credits_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pif_credits_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pif_credits_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pif_credits_parent_credit_id_fkey"
            columns: ["parent_credit_id"]
            isOneToOne: false
            referencedRelation: "pif_credits"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          customer_fee_percent: number
          feature_flags: Json
          helper_fee_percent: number
          hybrid_idv_enabled: boolean
          id: string
          idv_auto_approve_threshold: number
          latest_build: number
          min_supported_build: number
          onboarding_fee_cents: number
          platform_fee_percent: number
          social_webhook_url: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          customer_fee_percent?: number
          feature_flags?: Json
          helper_fee_percent?: number
          hybrid_idv_enabled?: boolean
          id?: string
          idv_auto_approve_threshold?: number
          latest_build?: number
          min_supported_build?: number
          onboarding_fee_cents?: number
          platform_fee_percent?: number
          social_webhook_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          customer_fee_percent?: number
          feature_flags?: Json
          helper_fee_percent?: number
          hybrid_idv_enabled?: boolean
          id?: string
          idv_auto_approve_threshold?: number
          latest_build?: number
          min_supported_build?: number
          onboarding_fee_cents?: number
          platform_fee_percent?: number
          social_webhook_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      profile_views: {
        Row: {
          hour_bucket: string
          id: number
          viewed_at: string
          viewed_user_id: string
          viewer_user_id: string
        }
        Insert: {
          hour_bucket?: string
          id?: number
          viewed_at?: string
          viewed_user_id: string
          viewer_user_id: string
        }
        Update: {
          hour_bucket?: string
          id?: number
          viewed_at?: string
          viewed_user_id?: string
          viewer_user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          accepted_terms_at: string | null
          apple_original_transaction_id: string | null
          application_count: number
          approval_email_count: number
          approval_status: string
          auto_suspended_until: string | null
          availability: string | null
          available_until: string | null
          avatar_url: string | null
          background_check_status: string
          ban_status: string | null
          bio: string | null
          created_at: string
          date_of_birth: string | null
          denial_email_count: number
          denial_reason: string | null
          drip_step: number
          email: string | null
          email_verified: boolean
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          experience_level: string | null
          extra_comments: string | null
          full_name: string | null
          has_applied_before: boolean
          hear_about_us: string | null
          hourly_rate: number | null
          id: string
          id_document_url: string | null
          id_verification_status: string
          idv_attempted_at: string | null
          idv_confidence: number | null
          idv_failure_reason: string | null
          idv_session_id: string | null
          idv_status: string | null
          insurance_rejection_reason: string | null
          insurance_reviewed_at: string | null
          insurance_reviewed_by: string | null
          insurance_status: string
          insurance_url: string | null
          intro_video_duration_seconds: number | null
          intro_video_thumbnail_url: string | null
          intro_video_url: string | null
          is_insured: boolean
          is_legacy_user: boolean
          is_licensed: boolean
          job_radius: string | null
          last_approval_email_at: string | null
          last_denial_email_at: string | null
          last_drip_at: string | null
          last_verification_email_at: string | null
          latitude: number | null
          legacy_manual_review: boolean
          license_rejection_reason: string | null
          license_reviewed_at: string | null
          license_reviewed_by: string | null
          license_status: string
          license_url: string | null
          location: string | null
          longitude: number | null
          marketing_consent: boolean
          onboarding_fee_charged_at: string | null
          onboarding_fee_paid: boolean
          parish: string | null
          phone: string | null
          portfolio_urls: string[] | null
          preferred_helper_id: string | null
          push_consent: boolean
          saved_helper_seen: Json
          senior_mode: boolean
          skills: string | null
          sms_consent: boolean
          stripe_account_id: string | null
          subscription_expires_at: string | null
          subscription_tier: string | null
          terms_accepted_at: string | null
          terms_version_accepted: string
          tools_equipment: string | null
          transportation: string | null
          updated_at: string
          user_id: string
          verification_email_count: number
          zip_code: string | null
        }
        Insert: {
          accepted_terms_at?: string | null
          apple_original_transaction_id?: string | null
          application_count?: number
          approval_email_count?: number
          approval_status?: string
          auto_suspended_until?: string | null
          availability?: string | null
          available_until?: string | null
          avatar_url?: string | null
          background_check_status?: string
          ban_status?: string | null
          bio?: string | null
          created_at?: string
          date_of_birth?: string | null
          denial_email_count?: number
          denial_reason?: string | null
          drip_step?: number
          email?: string | null
          email_verified?: boolean
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          experience_level?: string | null
          extra_comments?: string | null
          full_name?: string | null
          has_applied_before?: boolean
          hear_about_us?: string | null
          hourly_rate?: number | null
          id?: string
          id_document_url?: string | null
          id_verification_status?: string
          idv_attempted_at?: string | null
          idv_confidence?: number | null
          idv_failure_reason?: string | null
          idv_session_id?: string | null
          idv_status?: string | null
          insurance_rejection_reason?: string | null
          insurance_reviewed_at?: string | null
          insurance_reviewed_by?: string | null
          insurance_status?: string
          insurance_url?: string | null
          intro_video_duration_seconds?: number | null
          intro_video_thumbnail_url?: string | null
          intro_video_url?: string | null
          is_insured?: boolean
          is_legacy_user?: boolean
          is_licensed?: boolean
          job_radius?: string | null
          last_approval_email_at?: string | null
          last_denial_email_at?: string | null
          last_drip_at?: string | null
          last_verification_email_at?: string | null
          latitude?: number | null
          legacy_manual_review?: boolean
          license_rejection_reason?: string | null
          license_reviewed_at?: string | null
          license_reviewed_by?: string | null
          license_status?: string
          license_url?: string | null
          location?: string | null
          longitude?: number | null
          marketing_consent?: boolean
          onboarding_fee_charged_at?: string | null
          onboarding_fee_paid?: boolean
          parish?: string | null
          phone?: string | null
          portfolio_urls?: string[] | null
          preferred_helper_id?: string | null
          push_consent?: boolean
          saved_helper_seen?: Json
          senior_mode?: boolean
          skills?: string | null
          sms_consent?: boolean
          stripe_account_id?: string | null
          subscription_expires_at?: string | null
          subscription_tier?: string | null
          terms_accepted_at?: string | null
          terms_version_accepted?: string
          tools_equipment?: string | null
          transportation?: string | null
          updated_at?: string
          user_id: string
          verification_email_count?: number
          zip_code?: string | null
        }
        Update: {
          accepted_terms_at?: string | null
          apple_original_transaction_id?: string | null
          application_count?: number
          approval_email_count?: number
          approval_status?: string
          auto_suspended_until?: string | null
          availability?: string | null
          available_until?: string | null
          avatar_url?: string | null
          background_check_status?: string
          ban_status?: string | null
          bio?: string | null
          created_at?: string
          date_of_birth?: string | null
          denial_email_count?: number
          denial_reason?: string | null
          drip_step?: number
          email?: string | null
          email_verified?: boolean
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          experience_level?: string | null
          extra_comments?: string | null
          full_name?: string | null
          has_applied_before?: boolean
          hear_about_us?: string | null
          hourly_rate?: number | null
          id?: string
          id_document_url?: string | null
          id_verification_status?: string
          idv_attempted_at?: string | null
          idv_confidence?: number | null
          idv_failure_reason?: string | null
          idv_session_id?: string | null
          idv_status?: string | null
          insurance_rejection_reason?: string | null
          insurance_reviewed_at?: string | null
          insurance_reviewed_by?: string | null
          insurance_status?: string
          insurance_url?: string | null
          intro_video_duration_seconds?: number | null
          intro_video_thumbnail_url?: string | null
          intro_video_url?: string | null
          is_insured?: boolean
          is_legacy_user?: boolean
          is_licensed?: boolean
          job_radius?: string | null
          last_approval_email_at?: string | null
          last_denial_email_at?: string | null
          last_drip_at?: string | null
          last_verification_email_at?: string | null
          latitude?: number | null
          legacy_manual_review?: boolean
          license_rejection_reason?: string | null
          license_reviewed_at?: string | null
          license_reviewed_by?: string | null
          license_status?: string
          license_url?: string | null
          location?: string | null
          longitude?: number | null
          marketing_consent?: boolean
          onboarding_fee_charged_at?: string | null
          onboarding_fee_paid?: boolean
          parish?: string | null
          phone?: string | null
          portfolio_urls?: string[] | null
          preferred_helper_id?: string | null
          push_consent?: boolean
          saved_helper_seen?: Json
          senior_mode?: boolean
          skills?: string | null
          sms_consent?: boolean
          stripe_account_id?: string | null
          subscription_expires_at?: string | null
          subscription_tier?: string | null
          terms_accepted_at?: string | null
          terms_version_accepted?: string
          tools_equipment?: string | null
          transportation?: string | null
          updated_at?: string
          user_id?: string
          verification_email_count?: number
          zip_code?: string | null
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          app_version: string | null
          created_at: string
          device_id: string | null
          id: string
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          platform: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      referral_codes: {
        Row: {
          code: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      referral_credits: {
        Row: {
          amount: number
          created_at: string
          id: string
          reason: string
          redeemed: boolean
          referral_code_id: string | null
          referred_user_id: string | null
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          reason: string
          redeemed?: boolean
          referral_code_id?: string | null
          referred_user_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          reason?: string
          redeemed?: boolean
          referral_code_id?: string | null
          referred_user_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_credits_referral_code_id_fkey"
            columns: ["referral_code_id"]
            isOneToOne: false
            referencedRelation: "referral_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          created_at: string
          id: string
          referral_code_id: string
          referred_id: string
          referrer_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          referral_code_id: string
          referred_id: string
          referrer_id: string
        }
        Update: {
          created_at?: string
          id?: string
          referral_code_id?: string
          referred_id?: string
          referrer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referral_code_id_fkey"
            columns: ["referral_code_id"]
            isOneToOne: false
            referencedRelation: "referral_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          assigned_to: string | null
          created_at: string
          description: string | null
          id: string
          reason: string
          reported_id: string
          reported_type: string
          reporter_id: string
          status: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          id?: string
          reason: string
          reported_id: string
          reported_type: string
          reporter_id: string
          status?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          id?: string
          reason?: string
          reported_id?: string
          reported_type?: string
          reporter_id?: string
          status?: string
        }
        Relationships: []
      }
      retainer_agreements: {
        Row: {
          budget_per_session: number
          category: string
          created_at: string | null
          customer_id: string
          description: string | null
          discount_percent: number | null
          frequency: string
          helper_id: string
          id: string
          next_job_date: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          budget_per_session: number
          category: string
          created_at?: string | null
          customer_id: string
          description?: string | null
          discount_percent?: number | null
          frequency: string
          helper_id: string
          id?: string
          next_job_date?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          budget_per_session?: number
          category?: string
          created_at?: string | null
          customer_id?: string
          description?: string | null
          discount_percent?: number | null
          frequency?: string
          helper_id?: string
          id?: string
          next_job_date?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      reviews: {
        Row: {
          communication: number | null
          created_at: string
          feedback: string | null
          feedback_visible_at: string | null
          id: string
          job_id: string
          photo_urls: string[] | null
          punctuality: number | null
          quality: number | null
          rating: number
          response_at: string | null
          response_text: string | null
          reviewee_id: string
          reviewer_id: string
          status: string
        }
        Insert: {
          communication?: number | null
          created_at?: string
          feedback?: string | null
          feedback_visible_at?: string | null
          id?: string
          job_id: string
          photo_urls?: string[] | null
          punctuality?: number | null
          quality?: number | null
          rating: number
          response_at?: string | null
          response_text?: string | null
          reviewee_id: string
          reviewer_id: string
          status?: string
        }
        Update: {
          communication?: number | null
          created_at?: string
          feedback?: string | null
          feedback_visible_at?: string | null
          id?: string
          job_id?: string
          photo_urls?: string[] | null
          punctuality?: number | null
          quality?: number | null
          rating?: number
          response_at?: string | null
          response_text?: string | null
          reviewee_id?: string
          reviewer_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_jobs: {
        Row: {
          created_at: string
          id: string
          job_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_jobs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_jobs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_jobs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_searches: {
        Row: {
          category: string | null
          created_at: string
          id: string
          last_notified_at: string | null
          location_keyword: string | null
          max_budget: number | null
          min_budget: number | null
          name: string
          notify_enabled: boolean
          parish: string | null
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          last_notified_at?: string | null
          location_keyword?: string | null
          max_budget?: number | null
          min_budget?: number | null
          name: string
          notify_enabled?: boolean
          parish?: string | null
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          last_notified_at?: string | null
          location_keyword?: string | null
          max_budget?: number | null
          min_budget?: number | null
          name?: string
          notify_enabled?: boolean
          parish?: string | null
          user_id?: string
        }
        Relationships: []
      }
      skill_endorsements: {
        Row: {
          created_at: string
          endorser_id: string
          id: string
          job_id: string | null
          skill_id: string
        }
        Insert: {
          created_at?: string
          endorser_id: string
          id?: string
          job_id?: string | null
          skill_id: string
        }
        Update: {
          created_at?: string
          endorser_id?: string
          id?: string
          job_id?: string | null
          skill_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "skill_endorsements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_endorsements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_endorsements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_endorsements_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "helper_skills"
            referencedColumns: ["id"]
          },
        ]
      }
      social_post_drafts: {
        Row: {
          content: string
          created_at: string
          id: string
          image_url: string | null
          media_type: string
          published_at: string | null
          reviewed_by: string | null
          status: string
          style: string | null
          video_url: string | null
          voiceover_url: string | null
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          image_url?: string | null
          media_type?: string
          published_at?: string | null
          reviewed_by?: string | null
          status?: string
          style?: string | null
          video_url?: string | null
          voiceover_url?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          image_url?: string | null
          media_type?: string
          published_at?: string | null
          reviewed_by?: string | null
          status?: string
          style?: string | null
          video_url?: string | null
          voiceover_url?: string | null
        }
        Relationships: []
      }
      str_calendar_connections: {
        Row: {
          auto_create_cleaning: boolean
          cleaning_budget: number | null
          cleaning_notes: string | null
          created_at: string
          ical_url: string
          id: string
          is_active: boolean
          last_sync_error: string | null
          last_synced_at: string | null
          platform: string
          preferred_helper_id: string | null
          property_address: string | null
          property_name: string | null
          user_id: string
        }
        Insert: {
          auto_create_cleaning?: boolean
          cleaning_budget?: number | null
          cleaning_notes?: string | null
          created_at?: string
          ical_url: string
          id?: string
          is_active?: boolean
          last_sync_error?: string | null
          last_synced_at?: string | null
          platform: string
          preferred_helper_id?: string | null
          property_address?: string | null
          property_name?: string | null
          user_id: string
        }
        Update: {
          auto_create_cleaning?: boolean
          cleaning_budget?: number | null
          cleaning_notes?: string | null
          created_at?: string
          ical_url?: string
          id?: string
          is_active?: boolean
          last_sync_error?: string | null
          last_synced_at?: string | null
          platform?: string
          preferred_helper_id?: string | null
          property_address?: string | null
          property_name?: string | null
          user_id?: string
        }
        Relationships: []
      }
      str_processed_events: {
        Row: {
          checkout_date: string
          connection_id: string
          created_at: string
          event_uid: string
          id: string
          job_id: string | null
        }
        Insert: {
          checkout_date: string
          connection_id: string
          created_at?: string
          event_uid: string
          id?: string
          job_id?: string | null
        }
        Update: {
          checkout_date?: string
          connection_id?: string
          created_at?: string
          event_uid?: string
          id?: string
          job_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "str_processed_events_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "str_calendar_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "str_processed_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "str_processed_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "str_processed_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          event_id: string
          event_type: string
          processed_at: string
        }
        Insert: {
          event_id: string
          event_type: string
          processed_at?: string
        }
        Update: {
          event_id?: string
          event_type?: string
          processed_at?: string
        }
        Relationships: []
      }
      subscription_waitlist: {
        Row: {
          created_at: string
          desired_tier: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          desired_tier: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          desired_tier?: string
          id?: string
          user_id?: string
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
      thread_mutes: {
        Row: {
          job_id: string
          mute_until: string | null
          muted_at: string
          other_user_id: string
          user_id: string
        }
        Insert: {
          job_id: string
          mute_until?: string | null
          muted_at?: string
          other_user_id: string
          user_id: string
        }
        Update: {
          job_id?: string
          mute_until?: string | null
          muted_at?: string
          other_user_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_mutes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_mutes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_mutes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      time_credits: {
        Row: {
          amount_minutes: number
          balance_after: number | null
          created_at: string
          credit_type: string
          description: string | null
          id: string
          job_id: string | null
          user_id: string
        }
        Insert: {
          amount_minutes: number
          balance_after?: number | null
          created_at?: string
          credit_type: string
          description?: string | null
          id?: string
          job_id?: string | null
          user_id: string
        }
        Update: {
          amount_minutes?: number
          balance_after?: number | null
          created_at?: string
          credit_type?: string
          description?: string | null
          id?: string
          job_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_credits_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_credits_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_credits_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      tips: {
        Row: {
          amount: number
          created_at: string
          helper_id: string
          id: string
          job_id: string
          payment_status: string
          stripe_session_id: string | null
          tipper_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          helper_id: string
          id?: string
          job_id: string
          payment_status?: string
          stripe_session_id?: string | null
          tipper_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          helper_id?: string
          id?: string
          job_id?: string
          payment_status?: string
          stripe_session_id?: string | null
          tipper_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tips_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tips_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tips_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      user_bans: {
        Row: {
          ban_type: string
          banned_by: string
          created_at: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          reason: string
          user_id: string
        }
        Insert: {
          ban_type?: string
          banned_by: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          reason: string
          user_id: string
        }
        Update: {
          ban_type?: string
          banned_by?: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          reason?: string
          user_id?: string
        }
        Relationships: []
      }
      user_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
          reason: string | null
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
          reason?: string | null
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
          reason?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_strikes: {
        Row: {
          created_at: string
          dispute_id: string | null
          expires_at: string | null
          id: string
          issued_by: string | null
          job_id: string | null
          reason: string
          severity: number
          user_id: string
        }
        Insert: {
          created_at?: string
          dispute_id?: string | null
          expires_at?: string | null
          id?: string
          issued_by?: string | null
          job_id?: string | null
          reason: string
          severity?: number
          user_id: string
        }
        Update: {
          created_at?: string
          dispute_id?: string | null
          expires_at?: string | null
          id?: string
          issued_by?: string | null
          job_id?: string | null
          reason?: string
          severity?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_strikes_dispute_id_fkey"
            columns: ["dispute_id"]
            isOneToOne: false
            referencedRelation: "job_disputes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_strikes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_strikes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_strikes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      user_violations: {
        Row: {
          action_taken: string
          created_at: string | null
          description: string | null
          id: string
          job_id: string | null
          reported_by: string | null
          user_id: string
          violation_type: string
        }
        Insert: {
          action_taken?: string
          created_at?: string | null
          description?: string | null
          id?: string
          job_id?: string | null
          reported_by?: string | null
          user_id: string
          violation_type: string
        }
        Update: {
          action_taken?: string
          created_at?: string | null
          description?: string | null
          id?: string
          job_id?: string | null
          reported_by?: string | null
          user_id?: string
          violation_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_violations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_violations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_violations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_checks: {
        Row: {
          check_type: string
          completed_at: string | null
          credential_id: string
          expires_at: string | null
          failure_reason: string | null
          id: string
          initiated_at: string
          next_check_at: string | null
          raw_result: Json | null
          status: string
          user_id: string
          vendor: string
          vendor_check_id: string | null
        }
        Insert: {
          check_type: string
          completed_at?: string | null
          credential_id: string
          expires_at?: string | null
          failure_reason?: string | null
          id?: string
          initiated_at?: string
          next_check_at?: string | null
          raw_result?: Json | null
          status?: string
          user_id: string
          vendor: string
          vendor_check_id?: string | null
        }
        Update: {
          check_type?: string
          completed_at?: string | null
          credential_id?: string
          expires_at?: string | null
          failure_reason?: string | null
          id?: string
          initiated_at?: string
          next_check_at?: string | null
          raw_result?: Json | null
          status?: string
          user_id?: string
          vendor?: string
          vendor_check_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verification_checks_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "helper_credentials"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_exceptions: {
        Row: {
          assigned_to: string | null
          check_id: string | null
          created_at: string
          credential_id: string | null
          exception_type: string
          id: string
          notes: string | null
          resolution: string | null
          resolved_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          assigned_to?: string | null
          check_id?: string | null
          created_at?: string
          credential_id?: string | null
          exception_type: string
          id?: string
          notes?: string | null
          resolution?: string | null
          resolved_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          assigned_to?: string | null
          check_id?: string | null
          created_at?: string
          credential_id?: string | null
          exception_type?: string
          id?: string
          notes?: string | null
          resolution?: string | null
          resolved_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "verification_exceptions_check_id_fkey"
            columns: ["check_id"]
            isOneToOne: false
            referencedRelation: "verification_checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_exceptions_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "helper_credentials"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_protection_credits: {
        Row: {
          amount: number
          created_at: string
          credit_type: string
          expires_at: string | null
          helper_id: string
          id: string
          issued_at: string | null
          job_id: string | null
          reason: string | null
          status: string
        }
        Insert: {
          amount: number
          created_at?: string
          credit_type: string
          expires_at?: string | null
          helper_id: string
          id?: string
          issued_at?: string | null
          job_id?: string | null
          reason?: string | null
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string
          credit_type?: string
          expires_at?: string | null
          helper_id?: string
          id?: string
          issued_at?: string | null
          job_id?: string | null
          reason?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_protection_credits_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_protection_credits_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_protection_credits_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      jobs_helper_safe: {
        Row: {
          boost_expires_at: string | null
          boosted_at: string | null
          budget: number | null
          cancellation_fee: number | null
          cancellation_fee_status: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          category: Database["public"]["Enums"]["job_category"] | null
          created_at: string | null
          customer_id: string | null
          date_needed: string | null
          description: string | null
          dispute_deadline: string | null
          dispute_helper_response: string | null
          dispute_reason: string | null
          dispute_resolved_at: string | null
          dispute_status: string | null
          disputed_at: string | null
          disputed_by: string | null
          estimated_hours: number | null
          expires_at: string | null
          helper_arrived_at: string | null
          helper_completed_at: string | null
          helper_confirmed_at: string | null
          helper_fee_percent: number | null
          helper_id: string | null
          helper_on_the_way_at: string | null
          helpers_needed: number | null
          id: string | null
          is_flexible_schedule: boolean | null
          is_group_job: boolean | null
          is_recurring: boolean | null
          is_urgent: boolean | null
          late_cancellation: boolean | null
          latitude: number | null
          location: string | null
          longitude: number | null
          parent_job_id: string | null
          payment_status: string | null
          photos: string[] | null
          poster_completed_at: string | null
          poster_confirmed_at: string | null
          proof_after_urls: string[] | null
          proof_before_urls: string[] | null
          recurrence_end_date: string | null
          recurrence_interval: string | null
          response_deadline: string | null
          review_reminder_sent: boolean | null
          revision_acceptance_deadline: string | null
          revision_completed_at: string | null
          revision_deadline: string | null
          revision_note: string | null
          revision_requested_at: string | null
          special_requirements: string | null
          start_time: string | null
          status: Database["public"]["Enums"]["job_status"] | null
          title: string | null
          updated_at: string | null
          urgent_fee: number | null
        }
        Insert: {
          boost_expires_at?: string | null
          boosted_at?: string | null
          budget?: number | null
          cancellation_fee?: number | null
          cancellation_fee_status?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category?: Database["public"]["Enums"]["job_category"] | null
          created_at?: string | null
          customer_id?: string | null
          date_needed?: string | null
          description?: string | null
          dispute_deadline?: string | null
          dispute_helper_response?: string | null
          dispute_reason?: string | null
          dispute_resolved_at?: string | null
          dispute_status?: string | null
          disputed_at?: string | null
          disputed_by?: string | null
          estimated_hours?: number | null
          expires_at?: string | null
          helper_arrived_at?: string | null
          helper_completed_at?: string | null
          helper_confirmed_at?: string | null
          helper_fee_percent?: number | null
          helper_id?: string | null
          helper_on_the_way_at?: string | null
          helpers_needed?: number | null
          id?: string | null
          is_flexible_schedule?: boolean | null
          is_group_job?: boolean | null
          is_recurring?: boolean | null
          is_urgent?: boolean | null
          late_cancellation?: boolean | null
          latitude?: number | null
          location?: string | null
          longitude?: number | null
          parent_job_id?: string | null
          payment_status?: string | null
          photos?: string[] | null
          poster_completed_at?: string | null
          poster_confirmed_at?: string | null
          proof_after_urls?: string[] | null
          proof_before_urls?: string[] | null
          recurrence_end_date?: string | null
          recurrence_interval?: string | null
          response_deadline?: string | null
          review_reminder_sent?: boolean | null
          revision_acceptance_deadline?: string | null
          revision_completed_at?: string | null
          revision_deadline?: string | null
          revision_note?: string | null
          revision_requested_at?: string | null
          special_requirements?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["job_status"] | null
          title?: string | null
          updated_at?: string | null
          urgent_fee?: number | null
        }
        Update: {
          boost_expires_at?: string | null
          boosted_at?: string | null
          budget?: number | null
          cancellation_fee?: number | null
          cancellation_fee_status?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category?: Database["public"]["Enums"]["job_category"] | null
          created_at?: string | null
          customer_id?: string | null
          date_needed?: string | null
          description?: string | null
          dispute_deadline?: string | null
          dispute_helper_response?: string | null
          dispute_reason?: string | null
          dispute_resolved_at?: string | null
          dispute_status?: string | null
          disputed_at?: string | null
          disputed_by?: string | null
          estimated_hours?: number | null
          expires_at?: string | null
          helper_arrived_at?: string | null
          helper_completed_at?: string | null
          helper_confirmed_at?: string | null
          helper_fee_percent?: number | null
          helper_id?: string | null
          helper_on_the_way_at?: string | null
          helpers_needed?: number | null
          id?: string | null
          is_flexible_schedule?: boolean | null
          is_group_job?: boolean | null
          is_recurring?: boolean | null
          is_urgent?: boolean | null
          late_cancellation?: boolean | null
          latitude?: number | null
          location?: string | null
          longitude?: number | null
          parent_job_id?: string | null
          payment_status?: string | null
          photos?: string[] | null
          poster_completed_at?: string | null
          poster_confirmed_at?: string | null
          proof_after_urls?: string[] | null
          proof_before_urls?: string[] | null
          recurrence_end_date?: string | null
          recurrence_interval?: string | null
          response_deadline?: string | null
          review_reminder_sent?: boolean | null
          revision_acceptance_deadline?: string | null
          revision_completed_at?: string | null
          revision_deadline?: string | null
          revision_note?: string | null
          revision_requested_at?: string | null
          special_requirements?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["job_status"] | null
          title?: string | null
          updated_at?: string | null
          urgent_fee?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      open_jobs_browse: {
        Row: {
          applicant_count: number | null
          boost_expires_at: string | null
          boosted_at: string | null
          budget: number | null
          category: Database["public"]["Enums"]["job_category"] | null
          created_at: string | null
          customer_id: string | null
          date_needed: string | null
          description: string | null
          direct_offer_expires_at: string | null
          direct_offer_status: string | null
          estimated_hours: number | null
          expires_at: string | null
          helpers_needed: number | null
          id: string | null
          is_flexible_schedule: boolean | null
          is_group_job: boolean | null
          is_recurring: boolean | null
          is_urgent: boolean | null
          location: string | null
          offered_to_helper_id: string | null
          parent_job_id: string | null
          payment_status: string | null
          photos: string[] | null
          pricing_mode: string | null
          recurrence_end_date: string | null
          recurrence_interval: string | null
          special_requirements: string | null
          start_time: string | null
          status: Database["public"]["Enums"]["job_status"] | null
          title: string | null
          updated_at: string | null
          urgent_fee: number | null
        }
        Insert: {
          applicant_count?: never
          boost_expires_at?: string | null
          boosted_at?: string | null
          budget?: number | null
          category?: Database["public"]["Enums"]["job_category"] | null
          created_at?: string | null
          customer_id?: string | null
          date_needed?: string | null
          description?: string | null
          direct_offer_expires_at?: string | null
          direct_offer_status?: string | null
          estimated_hours?: number | null
          expires_at?: string | null
          helpers_needed?: number | null
          id?: string | null
          is_flexible_schedule?: boolean | null
          is_group_job?: boolean | null
          is_recurring?: boolean | null
          is_urgent?: boolean | null
          location?: never
          offered_to_helper_id?: string | null
          parent_job_id?: string | null
          payment_status?: string | null
          photos?: string[] | null
          pricing_mode?: string | null
          recurrence_end_date?: string | null
          recurrence_interval?: string | null
          special_requirements?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["job_status"] | null
          title?: string | null
          updated_at?: string | null
          urgent_fee?: number | null
        }
        Update: {
          applicant_count?: never
          boost_expires_at?: string | null
          boosted_at?: string | null
          budget?: number | null
          category?: Database["public"]["Enums"]["job_category"] | null
          created_at?: string | null
          customer_id?: string | null
          date_needed?: string | null
          description?: string | null
          direct_offer_expires_at?: string | null
          direct_offer_status?: string | null
          estimated_hours?: number | null
          expires_at?: string | null
          helpers_needed?: number | null
          id?: string | null
          is_flexible_schedule?: boolean | null
          is_group_job?: boolean | null
          is_recurring?: boolean | null
          is_urgent?: boolean | null
          location?: never
          offered_to_helper_id?: string | null
          parent_job_id?: string | null
          payment_status?: string | null
          photos?: string[] | null
          pricing_mode?: string | null
          recurrence_end_date?: string | null
          recurrence_interval?: string | null
          special_requirements?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["job_status"] | null
          title?: string | null
          updated_at?: string | null
          urgent_fee?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_application: {
        Args: {
          p_application_id: string
          p_deadline: string
          p_offer_message?: string
        }
        Returns: undefined
      }
      admin_list_business_accounts: {
        Args: never
        Returns: {
          billing_mode: string
          business_id: string
          business_name: string
          created_at: string
          last_activity_at: string
          member_count: number
          owner_email: string
          owner_id: string
          owner_name: string
          seat_tier: string
          total_gmv_cents: number
          verification_status: string
        }[]
      }
      admin_list_business_members: {
        Args: { _business_id: string }
        Returns: {
          email: string
          full_name: string
          joined_at: string
          member_id: string
          role: string
          status: string
          user_id: string
        }[]
      }
      apply_to_job: {
        Args: { p_job_id: string; p_message: string; p_proposed_price?: number }
        Returns: string
      }
      approve_pending_job: { Args: { p_job_id: string }; Returns: boolean }
      are_users_blocked: {
        Args: { _user_a: string; _user_b: string }
        Returns: boolean
      }
      business_activity_feed: {
        Args: { p_before?: string; p_business_id: string; p_limit?: number }
        Returns: {
          actor_id: string
          actor_name: string
          amount: number
          department: string
          event_at: string
          event_type: string
          job_id: string
          job_title: string
        }[]
      }
      business_budget_alert_check: {
        Args: { p_business_id: string }
        Returns: boolean
      }
      business_seat_limit: { Args: { _business_id: string }; Returns: number }
      business_spend_summary: {
        Args: { p_business_id: string }
        Returns: {
          email: string
          full_name: string
          in_escrow_amount: number
          paid_amount: number
          pending_amount: number
          posted_amount: number
          posted_count: number
          user_id: string
        }[]
      }
      can_message_in_job: {
        Args: { _job_id: string; _sender: string }
        Returns: boolean
      }
      can_review_job: {
        Args: { _job_id: string; _reviewer_id: string }
        Returns: boolean
      }
      check_dispute_velocity: { Args: { p_user_id: string }; Returns: boolean }
      cleanup_observability_tables: { Args: never; Returns: undefined }
      cleanup_stripe_webhook_events: { Args: never; Returns: undefined }
      clear_available_now: { Args: never; Returns: undefined }
      clear_thread_mute: {
        Args: { _job_id: string; _other_user_id: string }
        Returns: boolean
      }
      count_profiles: { Args: never; Returns: number }
      counter_application_bid: {
        Args: { p_application_id: string; p_counter_price: number }
        Returns: undefined
      }
      create_business_api_key: {
        Args: { _business_id: string; _name: string }
        Returns: Json
      }
      decline_job_offer: { Args: { p_application_id: string }; Returns: Json }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      detect_stuck_payments: { Args: never; Returns: number }
      detect_suspicious_user_patterns: { Args: never; Returns: number }
      endorse_skill: { Args: { p_skill_id: string }; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      expire_pending_direct_offers: { Args: never; Returns: number }
      extend_boosts_with_no_applications: {
        Args: never
        Returns: {
          job_id: string
          new_expires_at: string
        }[]
      }
      fan_out_broadcast_to_notifications: {
        Args: { _broadcast_id: string }
        Returns: number
      }
      get_approved_helpers: {
        Args: { max_count?: number }
        Returns: {
          avatar_url: string
          bio: string
          full_name: string
          location: string
          skills: string
          subscription_tier: string
          user_id: string
        }[]
      }
      get_business_seat_limit: {
        Args: { _business_id: string }
        Returns: number
      }
      get_category_price_stats: {
        Args: { p_category: string; p_parish?: string }
        Returns: {
          p25: number
          p50: number
          p75: number
          parish_match: boolean
          sample_count: number
        }[]
      }
      get_fill_rate_stats: {
        Args: { p_days?: number }
        Returns: {
          fill_rate_pct: number
          filled_jobs: number
          median_minutes_to_first_app: number
          parish: string
          parish_fill_rate_pct: number
          total_jobs: number
        }[]
      }
      get_helper_completed_counts: {
        Args: { p_user_ids: string[] }
        Returns: {
          completed_jobs: number
          user_id: string
        }[]
      }
      get_helper_distances_from_job: {
        Args: { p_job_id: string; p_user_ids: string[] }
        Returns: {
          distance_km: number
          user_id: string
        }[]
      }
      get_helper_earnings_export: {
        Args: { _end_date: string; _helper_id: string; _start_date: string }
        Returns: {
          category: string
          date_completed: string
          gross_budget: number
          job_id: string
          job_title: string
          net_payout: number
          parish: string
          parish_tax_collected: number
          platform_fee: number
          tax_status: string
        }[]
      }
      get_helper_on_time_percents: {
        Args: { p_user_ids: string[] }
        Returns: {
          on_time_percent: number
          user_id: string
        }[]
      }
      get_helper_parish_badges: {
        Args: { _user_id: string }
        Returns: {
          home_parish: string
          is_top_helper_in_parish: boolean
          is_verified_local: boolean
          parish_completed_jobs: number
        }[]
      }
      get_helper_repeat_hire_percents: {
        Args: { p_user_ids: string[] }
        Returns: {
          repeat_hire_percent: number
          user_id: string
        }[]
      }
      get_helper_tiers: {
        Args: { p_limit?: number }
        Returns: {
          avatar_url: string
          avg_rating: number
          completed_jobs: number
          full_name: string
          growth_score: number
          parish: string
          recent_avg_rating: number
          recent_reviews: number
          tier: string
          total_reviews: number
          user_id: string
        }[]
      }
      get_hero_parishes: {
        Args: never
        Returns: {
          hero_count: number
          parish: string
        }[]
      }
      get_job_view_counts: {
        Args: { p_job_ids: string[] }
        Returns: {
          job_id: string
          view_count: number
        }[]
      }
      get_marketplace_activity_count: { Args: never; Returns: number }
      get_monthly_profile_view_count: {
        Args: { p_user_id: string }
        Returns: number
      }
      get_muted_threads: {
        Args: { _pairs: Json }
        Returns: {
          job_id: string
          mute_until: string
          other_user_id: string
        }[]
      }
      get_my_business_verification: {
        Args: never
        Returns: {
          business_id: string
          business_name: string
          is_owner: boolean
          verification_document_type: string
          verification_document_url: string
          verification_rejection_reason: string
          verification_status: string
        }[]
      }
      get_my_saved_helpers: {
        Args: never
        Returns: {
          available_until: string
          avatar_url: string
          bio: string
          completed_jobs_together: number
          full_name: string
          helper_id: string
          hourly_rate: number
          last_job_at: string
          parish: string
          private_note: string
          saved_at: string
          skills: string
        }[]
      }
      get_neighbor_hire_count: {
        Args: {
          p_helper_id: string
          p_lat: number
          p_lng: number
          p_radius_km?: number
        }
        Returns: number
      }
      get_open_jobs_for_map: {
        Args: never
        Returns: {
          budget: number
          category: string
          created_at: string
          id: string
          is_urgent: boolean
          latitude: number
          longitude: number
          parish: string
          title: string
        }[]
      }
      get_parish_activity: {
        Args: { p_limit?: number }
        Returns: {
          active_jobs: number
          completed_jobs_30d: number
          helper_count: number
          parish: string
          revenue_30d: number
        }[]
      }
      get_parish_for_zip: { Args: { p_zip: string }; Returns: string }
      get_payout_batches: {
        Args: never
        Returns: {
          helper_email: string
          helper_id: string
          helper_name: string
          job_count: number
          oldest_completed_at: string
          stripe_account_id: string
          total_payout: number
        }[]
      }
      get_pending_business_verifications: {
        Args: never
        Returns: {
          business_id: string
          business_name: string
          document_type: string
          document_url: string
          owner_email: string
          owner_id: string
          owner_name: string
          submitted_at: string
        }[]
      }
      get_pending_credentials: {
        Args: never
        Returns: {
          avatar_url: string
          email: string
          full_name: string
          insurance_status: string
          insurance_url: string
          is_insured: boolean
          is_licensed: boolean
          license_status: string
          license_url: string
          submitted_at: string
          user_id: string
        }[]
      }
      get_pending_invite_for_email: {
        Args: { _email: string }
        Returns: {
          business_id: string
          business_name: string
          invite_id: string
          invited_by_name: string
        }[]
      }
      get_platform_benchmarks: {
        Args: never
        Returns: {
          avg_application_success_rate: number
          avg_helper_rating: number
        }[]
      }
      get_platform_impact_stats: {
        Args: never
        Returns: {
          avg_response_minutes: number
          earnings_this_month: number
          jobs_this_month: number
          total_earnings_circulated: number
          total_helpers_active: number
          total_jobs_completed: number
          total_parishes_served: number
          total_posters: number
        }[]
      }
      get_public_avg_rating: { Args: never; Returns: number }
      get_public_completed_job_count: { Args: never; Returns: number }
      get_public_job_stories: {
        Args: { p_limit?: number }
        Returns: {
          category: string
          helper_id: string
          id: string
          poster_completed_at: string
          proof_after_urls: string[]
          proof_before_urls: string[]
          title: string
        }[]
      }
      get_public_open_jobs: {
        Args: { p_limit?: number }
        Returns: {
          budget: number
          category: string
          date_needed: string
          id: string
          is_boosted: boolean
          is_urgent: boolean
          location: string
          title: string
        }[]
      }
      get_public_platform_settings: {
        Args: never
        Returns: {
          customer_fee_percent: number
          helper_fee_percent: number
          hybrid_idv_enabled: boolean
          id: string
          idv_auto_approve_threshold: number
          onboarding_fee_cents: number
          platform_fee_percent: number
        }[]
      }
      get_ranked_open_jobs: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          boost_expires_at: string
          boosted_at: string
          budget: number
          category: Database["public"]["Enums"]["job_category"]
          created_at: string
          date_needed: string
          description: string
          estimated_hours: number
          expires_at: string
          helpers_needed: number
          id: string
          is_flexible_schedule: boolean
          is_group_job: boolean
          is_recurring: boolean
          is_urgent: boolean
          location: string
          parish: string
          parish_match: boolean
          photos: string[]
          pricing_mode: string
          rank_score: number
          special_requirements: string
          start_time: string
          title: string
          urgent_fee: number
        }[]
      }
      get_recent_public_payouts: {
        Args: { _limit?: number }
        Returns: {
          amount_dollars: number
          city: string
          display_name: string
          paid_at: string
        }[]
      }
      get_safe_profiles: {
        Args: { user_ids: string[] }
        Returns: {
          avatar_url: string
          bio: string
          created_at: string
          full_name: string
          hourly_rate: number
          intro_video_duration_seconds: number
          intro_video_thumbnail_url: string
          intro_video_url: string
          is_id_verified: boolean
          location: string
          portfolio_urls: string[]
          role: string
          skills: string
          subscription_tier: string
          user_id: string
        }[]
      }
      get_service_role_key: { Args: never; Returns: string }
      get_supabase_url: { Args: never; Returns: string }
      get_time_credit_balance: { Args: { p_user_id: string }; Returns: number }
      get_top_helpers_by_parish: {
        Args: { p_limit?: number; p_parish?: string }
        Returns: {
          avatar_url: string
          avg_rating: number
          bio: string
          completed_jobs: number
          full_name: string
          hero_score: number
          location: string
          parish: string
          review_count: number
          skills: string
          subscription_tier: string
          user_id: string
        }[]
      }
      get_user_business_ids: { Args: { _user_id: string }; Returns: string[] }
      get_user_credential_tier: { Args: { p_user_id: string }; Returns: number }
      get_user_last_active: {
        Args: { user_ids: string[] }
        Returns: {
          last_active_at: string
          user_id: string
        }[]
      }
      get_user_repeat_hire_percent: {
        Args: { p_user_id: string }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_business_member: {
        Args: { _business_id: string; _user_id: string }
        Returns: boolean
      }
      is_business_owner: {
        Args: { _business_id: string; _user_id: string }
        Returns: boolean
      }
      is_category_taxable: {
        Args: { _category: Database["public"]["Enums"]["job_category"] }
        Returns: boolean
      }
      is_helper_shadowbanned: { Args: { _helper_id: string }; Returns: boolean }
      is_thread_muted: {
        Args: { _job_id: string; _other_user_id: string; _user: string }
        Returns: boolean
      }
      is_user_verified_business_member: {
        Args: { _user_id: string }
        Returns: boolean
      }
      log_notification: {
        Args: {
          _category: string
          _channel: string
          _error?: string
          _job_id?: string
          _message_id?: string
          _status: string
          _subject?: string
          _user_id: string
        }
        Returns: undefined
      }
      mark_applications_viewed: {
        Args: { p_job_id: string }
        Returns: undefined
      }
      mask_job_location: { Args: { loc: string }; Returns: string }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      process_referral: {
        Args: { p_new_user_id: string; p_referral_code: string }
        Returns: boolean
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      reassign_business_jobs: {
        Args: {
          p_business_id: string
          p_from_user_id: string
          p_to_user_id: string
        }
        Returns: number
      }
      record_job_view: { Args: { p_job_id: string }; Returns: string }
      record_profile_view: {
        Args: { p_viewed_user_id: string }
        Returns: boolean
      }
      redeem_pif_credit: {
        Args: { p_credit_id: string; p_job_id: string; p_user_id: string }
        Returns: Json
      }
      reject_other_applications_on_accept: {
        Args: { p_accepted_application_id: string; p_job_id: string }
        Returns: undefined
      }
      reject_pending_job: {
        Args: { p_job_id: string; p_reason?: string }
        Returns: boolean
      }
      report_helper_no_show: { Args: { p_job_id: string }; Returns: Json }
      respond_to_counter_offer: {
        Args: { p_accept: boolean; p_application_id: string }
        Returns: undefined
      }
      respond_to_review: {
        Args: { _response_text: string; _review_id: string }
        Returns: undefined
      }
      review_business_verification: {
        Args: {
          _business_id: string
          _decision: string
          _rejection_reason?: string
        }
        Returns: undefined
      }
      review_credential: {
        Args: {
          _credential: string
          _decision: string
          _reason?: string
          _user_id: string
        }
        Returns: undefined
      }
      rpc_check_application_rate: {
        Args: { _applicant_id: string }
        Returns: {
          allowed: boolean
          reason: string
          retry_after_seconds: number
        }[]
      }
      rpc_decide_dispute: {
        Args: {
          _decision_text: string
          _dispute_id: string
          _payout_split: Json
        }
        Returns: undefined
      }
      rpc_open_dispute: {
        Args: { _evidence_urls: string[]; _job_id: string; _reason: string }
        Returns: string
      }
      rpc_record_application_attempt: {
        Args: { _applicant_id: string }
        Returns: undefined
      }
      set_available_now: { Args: { p_hours?: number }; Returns: string }
      set_thread_snooze: {
        Args: { _job_id: string; _other_user_id: string; _until: string }
        Returns: string
      }
      sweep_daily_job_digest: { Args: never; Returns: number }
      sweep_expired_auto_bans: { Args: never; Returns: number }
      sweep_job_start_reminders: { Args: never; Returns: number }
      sweep_no_show_alerts: { Args: never; Returns: number }
      sweep_old_email_send_log: { Args: never; Returns: number }
      sweep_old_error_logs: { Args: never; Returns: number }
      sweep_old_notifications: { Args: never; Returns: number }
      sweep_pending_broadcast_fan_outs: { Args: never; Returns: number }
      toggle_thread_mute: {
        Args: { _job_id: string; _other_user_id: string }
        Returns: boolean
      }
      update_business_member_role: {
        Args: { p_member_id: string; p_role: string }
        Returns: boolean
      }
      user_has_pending_application: {
        Args: { _job_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "customer" | "helper"
      application_status: "pending" | "accepted" | "rejected"
      business_member_role: "owner" | "member"
      business_member_status: "pending" | "active" | "removed"
      job_category:
        | "cleaning"
        | "yard_work"
        | "moving"
        | "errands"
        | "handyman"
        | "painting"
        | "delivery"
        | "pet_care"
        | "assembly"
        | "other"
        | "storm_prep"
        | "events"
      job_status:
        | "open"
        | "accepted"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "revision_requested"
        | "disputed"
        | "pending_approval"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["admin", "customer", "helper"],
      application_status: ["pending", "accepted", "rejected"],
      business_member_role: ["owner", "member"],
      business_member_status: ["pending", "active", "removed"],
      job_category: [
        "cleaning",
        "yard_work",
        "moving",
        "errands",
        "handyman",
        "painting",
        "delivery",
        "pet_care",
        "assembly",
        "other",
        "storm_prep",
        "events",
      ],
      job_status: [
        "open",
        "accepted",
        "in_progress",
        "completed",
        "cancelled",
        "revision_requested",
        "disputed",
        "pending_approval",
      ],
    },
  },
} as const
