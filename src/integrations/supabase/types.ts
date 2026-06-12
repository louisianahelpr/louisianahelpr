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
      applications: {
        Row: {
          attachment_urls: string[] | null
          created_at: string
          helper_id: string
          id: string
          job_id: string
          message: string | null
          offer_message: string | null
          proposed_rate: number | null
          status: Database["public"]["Enums"]["application_status"]
          updated_at: string
        }
        Insert: {
          attachment_urls?: string[] | null
          created_at?: string
          helper_id: string
          id?: string
          job_id: string
          message?: string | null
          offer_message?: string | null
          proposed_rate?: number | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
        }
        Update: {
          attachment_urls?: string[] | null
          created_at?: string
          helper_id?: string
          id?: string
          job_id?: string
          message?: string | null
          offer_message?: string | null
          proposed_rate?: number | null
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
          {
            foreignKeyName: "applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_safe"
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
      business_members: {
        Row: {
          business_id: string
          created_at: string
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
      businesses: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
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
          created_at?: string
          id?: string
          name: string
          owner_id: string
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
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
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
      favorite_helpers: {
        Row: {
          created_at: string | null
          customer_id: string
          helper_id: string
          id: string
        }
        Insert: {
          created_at?: string | null
          customer_id: string
          helper_id: string
          id?: string
        }
        Update: {
          created_at?: string | null
          customer_id?: string
          helper_id?: string
          id?: string
        }
        Relationships: []
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
          {
            foreignKeyName: "fraud_flags_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_safe"
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
          {
            foreignKeyName: "group_job_helpers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_safe"
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
          {
            foreignKeyName: "job_checkins_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_safe"
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
          {
            foreignKeyName: "job_tracking_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
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
          customer_fee_amount: number | null
          customer_id: string
          date_needed: string
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
          flag_reasons: string[] | null
          helper_arrived_at: string | null
          helper_completed_at: string | null
          helper_confirmed_at: string | null
          helper_fee_percent: number | null
          helper_id: string | null
          helper_on_the_way_at: string | null
          helpers_needed: number | null
          id: string
          is_flexible_schedule: boolean
          is_group_job: boolean | null
          is_recurring: boolean | null
          is_urgent: boolean | null
          late_cancellation: boolean | null
          latitude: number | null
          location: string
          longitude: number | null
          offered_to_helper_id: string | null
          parent_job_id: string | null
          parish: string | null
          payment_status: string | null
          payout_scheduled_at: string | null
          photos: string[] | null
          platform_fee_amount: number | null
          platform_fee_percent: number | null
          poster_completed_at: string | null
          poster_confirmed_arrival_at: string | null
          poster_confirmed_at: string | null
          poster_confirmed_working_at: string | null
          proof_after_urls: string[] | null
          proof_before_urls: string[] | null
          recurrence_end_date: string | null
          recurrence_interval: string | null
          removal_reason: string | null
          removed_at: string | null
          removed_by: string | null
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
          special_requirements: string | null
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
          customer_fee_amount?: number | null
          customer_id: string
          date_needed: string
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
          flag_reasons?: string[] | null
          helper_arrived_at?: string | null
          helper_completed_at?: string | null
          helper_confirmed_at?: string | null
          helper_fee_percent?: number | null
          helper_id?: string | null
          helper_on_the_way_at?: string | null
          helpers_needed?: number | null
          id?: string
          is_flexible_schedule?: boolean
          is_group_job?: boolean | null
          is_recurring?: boolean | null
          is_urgent?: boolean | null
          late_cancellation?: boolean | null
          latitude?: number | null
          location: string
          longitude?: number | null
          offered_to_helper_id?: string | null
          parent_job_id?: string | null
          parish?: string | null
          payment_status?: string | null
          payout_scheduled_at?: string | null
          photos?: string[] | null
          platform_fee_amount?: number | null
          platform_fee_percent?: number | null
          poster_completed_at?: string | null
          poster_confirmed_arrival_at?: string | null
          poster_confirmed_at?: string | null
          poster_confirmed_working_at?: string | null
          proof_after_urls?: string[] | null
          proof_before_urls?: string[] | null
          recurrence_end_date?: string | null
          recurrence_interval?: string | null
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
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
          special_requirements?: string | null
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
          customer_fee_amount?: number | null
          customer_id?: string
          date_needed?: string
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
          flag_reasons?: string[] | null
          helper_arrived_at?: string | null
          helper_completed_at?: string | null
          helper_confirmed_at?: string | null
          helper_fee_percent?: number | null
          helper_id?: string | null
          helper_on_the_way_at?: string | null
          helpers_needed?: number | null
          id?: string
          is_flexible_schedule?: boolean
          is_group_job?: boolean | null
          is_recurring?: boolean | null
          is_urgent?: boolean | null
          late_cancellation?: boolean | null
          latitude?: number | null
          location?: string
          longitude?: number | null
          offered_to_helper_id?: string | null
          parent_job_id?: string | null
          parish?: string | null
          payment_status?: string | null
          payout_scheduled_at?: string | null
          photos?: string[] | null
          platform_fee_amount?: number | null
          platform_fee_percent?: number | null
          poster_completed_at?: string | null
          poster_confirmed_arrival_at?: string | null
          poster_confirmed_at?: string | null
          poster_confirmed_working_at?: string | null
          proof_after_urls?: string[] | null
          proof_before_urls?: string[] | null
          recurrence_end_date?: string | null
          recurrence_interval?: string | null
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
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
          special_requirements?: string | null
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
          {
            foreignKeyName: "jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_safe"
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
      messages: {
        Row: {
          attachment_mime: string | null
          attachment_size: number | null
          attachment_url: string | null
          content: string
          created_at: string
          flag_reason: string | null
          flagged_hidden: boolean
          id: string
          job_id: string
          read: boolean
          receiver_id: string
          sender_id: string
        }
        Insert: {
          attachment_mime?: string | null
          attachment_size?: number | null
          attachment_url?: string | null
          content: string
          created_at?: string
          flag_reason?: string | null
          flagged_hidden?: boolean
          id?: string
          job_id: string
          read?: boolean
          receiver_id: string
          sender_id: string
        }
        Update: {
          attachment_mime?: string | null
          attachment_size?: number | null
          attachment_url?: string | null
          content?: string
          created_at?: string
          flag_reason?: string | null
          flagged_hidden?: boolean
          id?: string
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
          {
            foreignKeyName: "messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_safe"
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
          messages: boolean
          new_offers: boolean
          payments: boolean
          promotions: boolean
          push_enabled: boolean
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
          messages?: boolean
          new_offers?: boolean
          payments?: boolean
          promotions?: boolean
          push_enabled?: boolean
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
          messages?: boolean
          new_offers?: boolean
          payments?: boolean
          promotions?: boolean
          push_enabled?: boolean
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
          {
            foreignKeyName: "payout_transfers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          customer_fee_percent: number
          helper_fee_percent: number
          hybrid_idv_enabled: boolean
          id: string
          idv_auto_approve_threshold: number
          onboarding_fee_cents: number
          platform_fee_percent: number
          social_webhook_url: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          customer_fee_percent?: number
          helper_fee_percent?: number
          hybrid_idv_enabled?: boolean
          id?: string
          idv_auto_approve_threshold?: number
          onboarding_fee_cents?: number
          platform_fee_percent?: number
          social_webhook_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          customer_fee_percent?: number
          helper_fee_percent?: number
          hybrid_idv_enabled?: boolean
          id?: string
          idv_auto_approve_threshold?: number
          onboarding_fee_cents?: number
          platform_fee_percent?: number
          social_webhook_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          accepted_terms_at: string | null
          application_count: number
          approval_email_count: number
          approval_status: string
          auto_suspended_until: string | null
          availability: string | null
          avatar_url: string | null
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
          hear_about_us: string | null
          hourly_rate: number | null
          id: string
          id_document_url: string | null
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
          is_insured: boolean
          is_legacy_user: boolean
          is_licensed: boolean
          job_radius: string | null
          last_approval_email_at: string | null
          last_denial_email_at: string | null
          last_drip_at: string | null
          last_verification_email_at: string | null
          legacy_manual_review: boolean
          license_rejection_reason: string | null
          license_reviewed_at: string | null
          license_reviewed_by: string | null
          license_status: string
          license_url: string | null
          location: string | null
          onboarding_fee_charged_at: string | null
          onboarding_fee_paid: boolean
          parish: string | null
          phone: string | null
          portfolio_urls: string[] | null
          skills: string | null
          stripe_account_id: string | null
          subscription_expires_at: string | null
          subscription_tier: string | null
          tools_equipment: string | null
          transportation: string | null
          updated_at: string
          user_id: string
          verification_email_count: number
          zip_code: string | null
        }
        Insert: {
          accepted_terms_at?: string | null
          application_count?: number
          approval_email_count?: number
          approval_status?: string
          auto_suspended_until?: string | null
          availability?: string | null
          avatar_url?: string | null
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
          hear_about_us?: string | null
          hourly_rate?: number | null
          id?: string
          id_document_url?: string | null
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
          is_insured?: boolean
          is_legacy_user?: boolean
          is_licensed?: boolean
          job_radius?: string | null
          last_approval_email_at?: string | null
          last_denial_email_at?: string | null
          last_drip_at?: string | null
          last_verification_email_at?: string | null
          legacy_manual_review?: boolean
          license_rejection_reason?: string | null
          license_reviewed_at?: string | null
          license_reviewed_by?: string | null
          license_status?: string
          license_url?: string | null
          location?: string | null
          onboarding_fee_charged_at?: string | null
          onboarding_fee_paid?: boolean
          parish?: string | null
          phone?: string | null
          portfolio_urls?: string[] | null
          skills?: string | null
          stripe_account_id?: string | null
          subscription_expires_at?: string | null
          subscription_tier?: string | null
          tools_equipment?: string | null
          transportation?: string | null
          updated_at?: string
          user_id: string
          verification_email_count?: number
          zip_code?: string | null
        }
        Update: {
          accepted_terms_at?: string | null
          application_count?: number
          approval_email_count?: number
          approval_status?: string
          auto_suspended_until?: string | null
          availability?: string | null
          avatar_url?: string | null
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
          hear_about_us?: string | null
          hourly_rate?: number | null
          id?: string
          id_document_url?: string | null
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
          is_insured?: boolean
          is_legacy_user?: boolean
          is_licensed?: boolean
          job_radius?: string | null
          last_approval_email_at?: string | null
          last_denial_email_at?: string | null
          last_drip_at?: string | null
          last_verification_email_at?: string | null
          legacy_manual_review?: boolean
          license_rejection_reason?: string | null
          license_reviewed_at?: string | null
          license_reviewed_by?: string | null
          license_status?: string
          license_url?: string | null
          location?: string | null
          onboarding_fee_charged_at?: string | null
          onboarding_fee_paid?: boolean
          parish?: string | null
          phone?: string | null
          portfolio_urls?: string[] | null
          skills?: string | null
          stripe_account_id?: string | null
          subscription_expires_at?: string | null
          subscription_tier?: string | null
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
          id: string
          job_id: string
          photo_urls: string[] | null
          punctuality: number | null
          quality: number | null
          rating: number
          reviewee_id: string
          reviewer_id: string
        }
        Insert: {
          communication?: number | null
          created_at?: string
          feedback?: string | null
          id?: string
          job_id: string
          photo_urls?: string[] | null
          punctuality?: number | null
          quality?: number | null
          rating: number
          reviewee_id: string
          reviewer_id: string
        }
        Update: {
          communication?: number | null
          created_at?: string
          feedback?: string | null
          id?: string
          job_id?: string
          photo_urls?: string[] | null
          punctuality?: number | null
          quality?: number | null
          rating?: number
          reviewee_id?: string
          reviewer_id?: string
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
          {
            foreignKeyName: "reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_safe"
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
          {
            foreignKeyName: "saved_jobs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_safe"
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
          {
            foreignKeyName: "tips_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_safe"
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
          {
            foreignKeyName: "user_violations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_safe"
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
          {
            foreignKeyName: "jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      open_jobs_browse: {
        Row: {
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
          {
            foreignKeyName: "jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      open_jobs_safe: {
        Row: {
          boost_expires_at: string | null
          boosted_at: string | null
          budget: number | null
          category: Database["public"]["Enums"]["job_category"] | null
          created_at: string | null
          date_needed: string | null
          description: string | null
          estimated_hours: number | null
          expires_at: string | null
          helpers_needed: number | null
          id: string | null
          is_flexible_schedule: boolean | null
          is_group_job: boolean | null
          is_recurring: boolean | null
          is_urgent: boolean | null
          location: string | null
          photos: string[] | null
          special_requirements: string | null
          start_time: string | null
          status: Database["public"]["Enums"]["job_status"] | null
          title: string | null
          urgent_fee: number | null
        }
        Insert: {
          boost_expires_at?: string | null
          boosted_at?: string | null
          budget?: number | null
          category?: Database["public"]["Enums"]["job_category"] | null
          created_at?: string | null
          date_needed?: string | null
          description?: string | null
          estimated_hours?: number | null
          expires_at?: string | null
          helpers_needed?: number | null
          id?: string | null
          is_flexible_schedule?: boolean | null
          is_group_job?: boolean | null
          is_recurring?: boolean | null
          is_urgent?: boolean | null
          location?: string | null
          photos?: string[] | null
          special_requirements?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["job_status"] | null
          title?: string | null
          urgent_fee?: number | null
        }
        Update: {
          boost_expires_at?: string | null
          boosted_at?: string | null
          budget?: number | null
          category?: Database["public"]["Enums"]["job_category"] | null
          created_at?: string | null
          date_needed?: string | null
          description?: string | null
          estimated_hours?: number | null
          expires_at?: string | null
          helpers_needed?: number | null
          id?: string | null
          is_flexible_schedule?: boolean | null
          is_group_job?: boolean | null
          is_recurring?: boolean | null
          is_urgent?: boolean | null
          location?: string | null
          photos?: string[] | null
          special_requirements?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["job_status"] | null
          title?: string | null
          urgent_fee?: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      // ── HAND-ADDED (not produced by `npm run db:types`) ──────────────
      // These RPCs exist in the database but were missing from the last
      // generated types. Re-running `npm run db:types` folds them in
      // properly and this block can then be deleted.
      accept_application: {
        Args: {
          p_application_id: string
          p_deadline: string | null
          p_offer_message: string | null
        }
        Returns: undefined
      }
      decline_job_offer: {
        Args: { p_application_id: string }
        Returns: { action: string; prior_count: number }
      }
      get_category_price_stats: {
        Args: { p_category: string; p_parish: string | null }
        Returns: {
          p25: number | null
          p50: number | null
          p75: number | null
          sample_count: number | null
          parish_match: boolean | null
        }[]
      }
      report_helper_no_show: {
        Args: { p_job_id: string }
        Returns: { action: string }
      }
      reject_other_applications_on_accept: {
        Args: { p_job_id: string; p_accepted_application_id: string }
        Returns: undefined
      }
      get_marketplace_activity_count: { Args: never; Returns: number }
      get_open_jobs_for_map: {
        Args: never
        Returns: {
          id: string
          title: string
          category: string
          budget: number
          is_urgent: boolean
          latitude: number
          longitude: number
          parish: string | null
          created_at: string
        }[]
      }
      // ─────────────────────────────────────────────────────────────────
      are_users_blocked: {
        Args: { _user_a: string; _user_b: string }
        Returns: boolean
      }
      business_seat_limit: { Args: { _business_id: string }; Returns: number }
      can_review_job: {
        Args: { _job_id: string; _reviewer_id: string }
        Returns: boolean
      }
      check_dispute_velocity: { Args: { p_user_id: string }; Returns: boolean }
      cleanup_observability_tables: { Args: never; Returns: undefined }
      cleanup_stripe_webhook_events: { Args: never; Returns: undefined }
      count_profiles: { Args: never; Returns: number }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
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
      get_helper_parish_badges: {
        Args: { _user_id: string }
        Returns: {
          home_parish: string
          is_top_helper_in_parish: boolean
          is_verified_local: boolean
          parish_completed_jobs: number
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
          avatar_url: string
          bio: string
          completed_jobs_together: number
          full_name: string
          helper_id: string
          hourly_rate: number
          last_job_at: string
          parish: string
          saved_at: string
          skills: string
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
          rank_score: number
          special_requirements: string
          start_time: string
          title: string
          urgent_fee: number
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
      get_user_last_active: {
        Args: { user_ids: string[] }
        Returns: {
          last_active_at: string
          user_id: string
        }[]
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
      sweep_pending_broadcast_fan_outs: { Args: never; Returns: number }
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
      job_status:
        | "open"
        | "accepted"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "revision_requested"
        | "disputed"
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
      ],
      job_status: [
        "open",
        "accepted",
        "in_progress",
        "completed",
        "cancelled",
        "revision_requested",
        "disputed",
      ],
    },
  },
} as const
