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
      account_deletion_log: {
        Row: {
          deleted_at: string
          id: number
          summarized_at: string | null
        }
        Insert: {
          deleted_at?: string
          id?: never
          summarized_at?: string | null
        }
        Update: {
          deleted_at?: string
          id?: never
          summarized_at?: string | null
        }
        Relationships: []
      }
      admin_audit_log: {
        Row: {
          action: string
          admin_id: string | null
          created_at: string
          details: Json | null
          id: string
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          admin_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          admin_id?: string | null
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
      apple_sign_in_tokens: {
        Row: {
          client_id: string
          created_at: string
          refresh_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          refresh_token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          refresh_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      application_email_state: {
        Row: {
          last_emailed_at: string | null
          updated_at: string
          user_id: string
          waiting: number
        }
        Insert: {
          last_emailed_at?: string | null
          updated_at?: string
          user_id: string
          waiting?: number
        }
        Update: {
          last_emailed_at?: string | null
          updated_at?: string
          user_id?: string
          waiting?: number
        }
        Relationships: []
      }
      application_nudge_sends: {
        Row: {
          job_id: string
          sent_at: string
          user_id: string
        }
        Insert: {
          job_id: string
          sent_at?: string
          user_id: string
        }
        Update: {
          job_id?: string
          sent_at?: string
          user_id?: string
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
          closed_reason: string | null
          created_at: string
          decline_reason: string | null
          flag_reason: string | null
          flagged_hidden: boolean
          helper_id: string
          id: string
          job_id: string
          job_latitude: number | null
          job_longitude: number | null
          job_point_void: boolean
          message: string | null
          message_withheld: string | null
          offer_message: string | null
          offer_message_flagged_hidden: boolean
          offer_message_withheld: string | null
          poster_viewed_at: string | null
          stake_amount: number | null
          stake_status: string | null
          suggested_date: string | null
          suggested_start_time: string | null
          status: Database["public"]["Enums"]["application_status"]
          updated_at: string
        }
        Insert: {
          attachment_urls?: string[] | null
          closed_reason?: string | null
          created_at?: string
          decline_reason?: string | null
          flag_reason?: string | null
          flagged_hidden?: boolean
          helper_id: string
          id?: string
          job_id: string
          job_latitude?: number | null
          job_longitude?: number | null
          job_point_void?: boolean
          message?: string | null
          message_withheld?: string | null
          offer_message?: string | null
          offer_message_flagged_hidden?: boolean
          offer_message_withheld?: string | null
          poster_viewed_at?: string | null
          stake_amount?: number | null
          stake_status?: string | null
          suggested_date?: string | null
          suggested_start_time?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
        }
        Update: {
          attachment_urls?: string[] | null
          closed_reason?: string | null
          created_at?: string
          decline_reason?: string | null
          flag_reason?: string | null
          flagged_hidden?: boolean
          helper_id?: string
          id?: string
          job_id?: string
          job_latitude?: number | null
          job_longitude?: number | null
          job_point_void?: boolean
          message?: string | null
          message_withheld?: string | null
          offer_message?: string | null
          offer_message_flagged_hidden?: boolean
          offer_message_withheld?: string | null
          poster_viewed_at?: string | null
          stake_amount?: number | null
          stake_status?: string | null
          suggested_date?: string | null
          suggested_start_time?: string | null
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
      backout_notices: {
        Row: {
          acknowledged_at: string | null
          actor_name: string | null
          backout_kind: string
          created_at: string
          id: string
          job_id: string
          last_push_at: string | null
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          actor_name?: string | null
          backout_kind: string
          created_at?: string
          id?: string
          job_id: string
          last_push_at?: string | null
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          actor_name?: string | null
          backout_kind?: string
          created_at?: string
          id?: string
          job_id?: string
          last_push_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ban_evasion_matches: {
        Row: {
          auto_banned: boolean
          cleared_at: string | null
          created_at: string
          id: string
          match_sha256: string | null
          matched_on: string
          original_ban_status: string | null
          original_expires_at: string | null
          original_reason: string | null
          original_recorded_at: string | null
          resolved: boolean
          retained_ban_id: string | null
          user_id: string
        }
        Insert: {
          auto_banned?: boolean
          cleared_at?: string | null
          created_at?: string
          id?: string
          match_sha256?: string | null
          matched_on: string
          original_ban_status?: string | null
          original_expires_at?: string | null
          original_reason?: string | null
          original_recorded_at?: string | null
          resolved?: boolean
          retained_ban_id?: string | null
          user_id: string
        }
        Update: {
          auto_banned?: boolean
          cleared_at?: string | null
          created_at?: string
          id?: string
          match_sha256?: string | null
          matched_on?: string
          original_ban_status?: string | null
          original_expires_at?: string | null
          original_reason?: string | null
          original_recorded_at?: string | null
          resolved?: boolean
          retained_ban_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ban_settlement_queue: {
        Row: {
          alerted_at: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          deferred_at: string | null
          deferred_ban_status: string | null
          deferred_rungs: Json
          deferred_suspended_until: string | null
          id: string
          matched_on: string
          original_ban_status: string | null
          original_expires_at: string | null
          review_state: string
          user_id: string
        }
        Insert: {
          alerted_at?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          deferred_at?: string | null
          deferred_ban_status?: string | null
          deferred_rungs?: Json
          deferred_suspended_until?: string | null
          id?: string
          matched_on: string
          original_ban_status?: string | null
          original_expires_at?: string | null
          review_state?: string
          user_id: string
        }
        Update: {
          alerted_at?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          deferred_at?: string | null
          deferred_ban_status?: string | null
          deferred_rungs?: Json
          deferred_suspended_until?: string | null
          id?: string
          matched_on?: string
          original_ban_status?: string | null
          original_expires_at?: string | null
          review_state?: string
          user_id?: string
        }
        Relationships: []
      }
      booking_sources: {
        Row: {
          created_at: string
          helpr_id: string
          source: string
          user_id: string
        }
        Insert: {
          created_at?: string
          helpr_id: string
          source?: string
          user_id: string
        }
        Update: {
          created_at?: string
          helpr_id?: string
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      cancellation_fee_transfers: {
        Row: {
          commission_percent: number
          created_at: string
          failure_reason: string | null
          failed_transfer_ids: string[]
          fee_amount: number
          helper_amount: number
          helper_id: string | null
          id: string
          job_id: string
          paid_at: string | null
          platform_cut: number
          status: string
          stripe_transfer_id: string | null
          updated_at: string
        }
        Insert: {
          commission_percent: number
          created_at?: string
          failure_reason?: string | null
          failed_transfer_ids?: string[]
          fee_amount: number
          helper_amount: number
          helper_id?: string | null
          id?: string
          job_id: string
          paid_at?: string | null
          platform_cut: number
          status?: string
          stripe_transfer_id?: string | null
          updated_at?: string
        }
        Update: {
          commission_percent?: number
          created_at?: string
          failure_reason?: string | null
          failed_transfer_ids?: string[]
          fee_amount?: number
          helper_amount?: number
          helper_id?: string | null
          id?: string
          job_id?: string
          paid_at?: string | null
          platform_cut?: number
          status?: string
          stripe_transfer_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cancellation_fee_transfers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cancellation_fee_transfers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cancellation_fee_transfers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      category_suggestions: {
        Row: {
          admin_note: string | null
          created_at: string
          id: string
          normalized: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          suggested_in: string
          suggestion: string
          user_id: string | null
        }
        Insert: {
          admin_note?: string | null
          created_at?: string
          id?: string
          normalized?: never
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          suggested_in: string
          suggestion: string
          user_id?: string | null
        }
        Update: {
          admin_note?: string | null
          created_at?: string
          id?: string
          normalized?: never
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          suggested_in?: string
          suggestion?: string
          user_id?: string | null
        }
        Relationships: []
      }
      chargeback_clawbacks: {
        Row: {
          created_at: string
          dispute_id: string
          failure_reason: string | null
          held_repay_first_attempt_at: string | null
          held_repay_owed_at: string | null
          helper_id: string | null
          id: string
          job_id: string
          original_transfer_id: string
          repay_transfer_id: string | null
          reversed_cents: number
          status: string
          stripe_account_id: string | null
          stripe_reversal_id: string | null
          transfer_amount_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          dispute_id: string
          failure_reason?: string | null
          held_repay_first_attempt_at?: string | null
          held_repay_owed_at?: string | null
          helper_id?: string | null
          id?: string
          job_id: string
          original_transfer_id: string
          repay_transfer_id?: string | null
          reversed_cents?: number
          status?: string
          stripe_account_id?: string | null
          stripe_reversal_id?: string | null
          transfer_amount_cents: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          dispute_id?: string
          failure_reason?: string | null
          held_repay_first_attempt_at?: string | null
          held_repay_owed_at?: string | null
          helper_id?: string | null
          id?: string
          job_id?: string
          original_transfer_id?: string
          repay_transfer_id?: string | null
          reversed_cents?: number
          status?: string
          stripe_account_id?: string | null
          stripe_reversal_id?: string | null
          transfer_amount_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chargeback_clawbacks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chargeback_clawbacks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chargeback_clawbacks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      come_back_email_sends: {
        Row: {
          claimed_at: string
          email_step: number
          message_id: string | null
          queued_at: string | null
          user_id: string
        }
        Insert: {
          claimed_at?: string
          email_step: number
          message_id?: string | null
          queued_at?: string | null
          user_id: string
        }
        Update: {
          claimed_at?: string
          email_step?: number
          message_id?: string | null
          queued_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      connect_account_retirements: {
        Row: {
          created_at: string
          delete_error: string | null
          delete_outcome: string
          id: string
          reason: string
          replacement_account_id: string
          stripe_account_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          delete_error?: string | null
          delete_outcome: string
          id?: string
          reason: string
          replacement_account_id: string
          stripe_account_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          delete_error?: string | null
          delete_outcome?: string
          id?: string
          reason?: string
          replacement_account_id?: string
          stripe_account_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      confirm_reminder_sends: {
        Row: {
          claimed_at: string
          message_id: string | null
          queued_at: string | null
          reminder_step: number
          user_id: string
        }
        Insert: {
          claimed_at?: string
          message_id?: string | null
          queued_at?: string | null
          reminder_step: number
          user_id: string
        }
        Update: {
          claimed_at?: string
          message_id?: string | null
          queued_at?: string | null
          reminder_step?: number
          user_id?: string
        }
        Relationships: []
      }
      crew_block_fees: {
        Row: {
          created_at: string
          failure_reason: string | null
          fee_cents: number
          fee_percent: number
          helper_id: string | null
          id: string
          job_id: string
          paid_at: string | null
          share_basis_cents: number
          slot_no: number
          status: string
          stripe_transfer_id: string | null
        }
        Insert: {
          created_at?: string
          failure_reason?: string | null
          fee_cents: number
          fee_percent: number
          helper_id?: string | null
          id?: string
          job_id: string
          paid_at?: string | null
          share_basis_cents: number
          slot_no: number
          status?: string
          stripe_transfer_id?: string | null
        }
        Update: {
          created_at?: string
          failure_reason?: string | null
          fee_cents?: number
          fee_percent?: number
          helper_id?: string | null
          id?: string
          job_id?: string
          paid_at?: string | null
          share_basis_cents?: number
          slot_no?: number
          status?: string
          stripe_transfer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crew_block_fees_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_block_fees_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_block_fees_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_cancellation_fee_shares: {
        Row: {
          committed: boolean
          created_at: string
          failed_transfer_ids: string[]
          fee_percent: number
          helper_id: string | null
          id: string
          job_id: string
          paid_at: string | null
          share_amount: number
          share_basis_cents: number
          status: string
          stripe_transfer_id: string | null
        }
        Insert: {
          committed: boolean
          created_at?: string
          failed_transfer_ids?: string[]
          fee_percent: number
          helper_id?: string | null
          id?: string
          job_id: string
          paid_at?: string | null
          share_amount: number
          share_basis_cents: number
          status?: string
          stripe_transfer_id?: string | null
        }
        Update: {
          committed?: boolean
          created_at?: string
          failed_transfer_ids?: string[]
          fee_percent?: number
          helper_id?: string | null
          id?: string
          job_id?: string
          paid_at?: string | null
          share_amount?: number
          share_basis_cents?: number
          status?: string
          stripe_transfer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crew_cancellation_fee_shares_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_cancellation_fee_shares_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_cancellation_fee_shares_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_confirm_pending: {
        Row: {
          helper_id: string
          job_id: string
          requested_at: string
          slot_id: string
        }
        Insert: {
          helper_id: string
          job_id: string
          requested_at?: string
          slot_id: string
        }
        Update: {
          helper_id?: string
          job_id?: string
          requested_at?: string
          slot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crew_confirm_pending_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: true
            referencedRelation: "group_job_helpers"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_dispute_member_outcomes: {
        Row: {
          decided_at: string
          decided_by: string | null
          dispute_id: string
          helper_id: string | null
          id: string
          job_id: string
          member_outcome: string
          share_cents: number
          slot_no: number
        }
        Insert: {
          decided_at?: string
          decided_by?: string | null
          dispute_id: string
          helper_id?: string | null
          id?: string
          job_id: string
          member_outcome: string
          share_cents: number
          slot_no: number
        }
        Update: {
          decided_at?: string
          decided_by?: string | null
          dispute_id?: string
          helper_id?: string | null
          id?: string
          job_id?: string
          member_outcome?: string
          share_cents?: number
          slot_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "crew_dispute_member_outcomes_dispute_id_fkey"
            columns: ["dispute_id"]
            isOneToOne: false
            referencedRelation: "disputes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_dispute_member_outcomes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_dispute_member_outcomes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_dispute_member_outcomes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_catchup_policy: {
        Row: {
          catch_up: boolean
          jobname: string
          max_late: string
          reason: string
          updated_at: string
        }
        Insert: {
          catch_up: boolean
          jobname: string
          max_late: string
          reason: string
          updated_at?: string
        }
        Update: {
          catch_up?: boolean
          jobname?: string
          max_late?: string
          reason?: string
          updated_at?: string
        }
        Relationships: []
      }
      cron_catchup_runs: {
        Row: {
          action: string
          decided_at: string
          detail: string | null
          http_checked_at: string | null
          http_status: number | null
          jobname: string
          request_id: number | null
          slot: string
        }
        Insert: {
          action: string
          decided_at?: string
          detail?: string | null
          http_checked_at?: string | null
          http_status?: number | null
          jobname: string
          request_id?: number | null
          slot: string
        }
        Update: {
          action?: string
          decided_at?: string
          detail?: string | null
          http_checked_at?: string | null
          http_status?: number | null
          jobname?: string
          request_id?: number | null
          slot?: string
        }
        Relationships: []
      }
      cron_catchup_schedules: {
        Row: {
          active: boolean
          jobid: number
          jobname: string | null
          schedule: string
          since: string
        }
        Insert: {
          active?: boolean
          jobid: number
          jobname?: string | null
          schedule: string
          since?: string
        }
        Update: {
          active?: boolean
          jobid?: number
          jobname?: string | null
          schedule?: string
          since?: string
        }
        Relationships: []
      }
      cron_http_requests: {
        Row: {
          created_at: string
          jobname: string
          request_id: number
        }
        Insert: {
          created_at?: string
          jobname: string
          request_id: number
        }
        Update: {
          created_at?: string
          jobname?: string
          request_id?: number
        }
        Relationships: []
      }
      cron_job_first_seen: {
        Row: {
          first_seen: string
          jobname: string
        }
        Insert: {
          first_seen?: string
          jobname: string
        }
        Update: {
          first_seen?: string
          jobname?: string
        }
        Relationships: []
      }
      cron_run_log: {
        Row: {
          body: Json
          created_at: string
          id: number
          jobname: string
          occurred_at: string
          response_id: number | null
          status_code: number | null
        }
        Insert: {
          body?: Json
          created_at?: string
          id?: never
          jobname: string
          occurred_at: string
          response_id?: number | null
          status_code?: number | null
        }
        Update: {
          body?: Json
          created_at?: string
          id?: never
          jobname?: string
          occurred_at?: string
          response_id?: number | null
          status_code?: number | null
        }
        Relationships: []
      }
      cron_work_expectations: {
        Row: {
          candidate_key: string | null
          disposition_keys: string[] | null
          expected_max_gap: string | null
          jobname: string
          max_idle: string | null
          min_streak: number
          note: string
          registered_at: string
          work_exempt_reason: string | null
          work_keys: string[] | null
          work_visibility: string | null
        }
        Insert: {
          candidate_key?: string | null
          disposition_keys?: string[] | null
          expected_max_gap?: string | null
          jobname: string
          max_idle?: string | null
          min_streak?: number
          note?: string
          registered_at?: string
          work_exempt_reason?: string | null
          work_keys?: string[] | null
          work_visibility?: string | null
        }
        Update: {
          candidate_key?: string | null
          disposition_keys?: string[] | null
          expected_max_gap?: string | null
          jobname?: string
          max_idle?: string | null
          min_streak?: number
          note?: string
          registered_at?: string
          work_exempt_reason?: string | null
          work_keys?: string[] | null
          work_visibility?: string | null
        }
        Relationships: []
      }
      db_saturation_samples: {
        Row: {
          active_conns: number | null
          calls_per_s: number | null
          client_conns: number | null
          conn_pct: number | null
          db_problems: string[]
          exec_ms_per_s: number | null
          id: number
          idle_in_xact: number | null
          log_problem: string | null
          log_timeouts: number | null
          log_window_minutes: number | null
          longest_active_s: number | null
          max_conns: number | null
          origin: string
          p95_ms: number | null
          sampled_at: string
          window_app_calls: number | null
          window_s: number | null
        }
        Insert: {
          active_conns?: number | null
          calls_per_s?: number | null
          client_conns?: number | null
          conn_pct?: number | null
          db_problems?: string[]
          exec_ms_per_s?: number | null
          id?: number
          idle_in_xact?: number | null
          log_problem?: string | null
          log_timeouts?: number | null
          log_window_minutes?: number | null
          longest_active_s?: number | null
          max_conns?: number | null
          origin?: string
          p95_ms?: number | null
          sampled_at?: string
          window_app_calls?: number | null
          window_s?: number | null
        }
        Update: {
          active_conns?: number | null
          calls_per_s?: number | null
          client_conns?: number | null
          conn_pct?: number | null
          db_problems?: string[]
          exec_ms_per_s?: number | null
          id?: number
          idle_in_xact?: number | null
          log_problem?: string | null
          log_timeouts?: number | null
          log_window_minutes?: number | null
          longest_active_s?: number | null
          max_conns?: number | null
          origin?: string
          p95_ms?: number | null
          sampled_at?: string
          window_app_calls?: number | null
          window_s?: number | null
        }
        Relationships: []
      }
      db_saturation_state: {
        Row: {
          app_stats: Json
          id: number
          sampled_at: string
          total_calls: number
          total_ms: number
        }
        Insert: {
          app_stats?: Json
          id?: number
          sampled_at: string
          total_calls: number
          total_ms: number
        }
        Update: {
          app_stats?: Json
          id?: number
          sampled_at?: string
          total_calls?: number
          total_ms?: number
        }
        Relationships: []
      }
      declutter_bookings: {
        Row: {
          buyer_on_way_at: string | null
          buyer_id: string
          buyer_missed_at: string | null
          buyer_rebooked: boolean
          buyer_reschedules: number
          created_at: string
          is_seed: boolean
          order_id: string
          pickup_day: string | null
          porch_mode: string | null
          porch_until: string | null
          reminded_slot_start: string | null
          seller_id: string
          seller_reschedules: number
          slot_end: string | null
          slot_start: string | null
          updated_at: string
        }
        Insert: {
          buyer_on_way_at?: string | null
          buyer_id: string
          buyer_missed_at?: string | null
          buyer_rebooked?: boolean
          buyer_reschedules?: number
          created_at?: string
          is_seed?: boolean
          order_id: string
          pickup_day?: string | null
          porch_mode?: string | null
          porch_until?: string | null
          reminded_slot_start?: string | null
          seller_id: string
          seller_reschedules?: number
          slot_end?: string | null
          slot_start?: string | null
          updated_at?: string
        }
        Update: {
          buyer_on_way_at?: string | null
          buyer_id?: string
          buyer_missed_at?: string | null
          buyer_rebooked?: boolean
          buyer_reschedules?: number
          created_at?: string
          is_seed?: boolean
          order_id?: string
          pickup_day?: string | null
          porch_mode?: string | null
          porch_until?: string | null
          reminded_slot_start?: string | null
          seller_id?: string
          seller_reschedules?: number
          slot_end?: string | null
          slot_start?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "declutter_bookings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "declutter_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_bundle_rules: {
        Row: {
          percent: number
          seller_id: string
          updated_at: string
        }
        Insert: {
          percent: number
          seller_id: string
          updated_at?: string
        }
        Update: {
          percent?: number
          seller_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      declutter_buyer_cards: {
        Row: {
          brand: string | null
          last4: string | null
          payment_method_id: string
          saved_at: string
          stripe_customer_id: string
          card_mode: string
          user_id: string
        }
        Insert: {
          brand?: string | null
          last4?: string | null
          payment_method_id: string
          saved_at?: string
          stripe_customer_id: string
          card_mode?: string
          user_id: string
        }
        Update: {
          brand?: string | null
          last4?: string | null
          payment_method_id?: string
          saved_at?: string
          stripe_customer_id?: string
          card_mode?: string
          user_id?: string
        }
        Relationships: [
        ]
      }
      declutter_cart_items: {
        Row: {
          list_price_cents: number | null
          buyer_id: string | null
          checkout_by: string
          closed_at: string | null
          created_at: string
          id: string
          is_seed: boolean
          item_id: string | null
          item_title: string | null
          offer_id: string | null
          order_id: string | null
          price_cents: number
          reminded_24h_at: string | null
          reminded_2h_at: string | null
          seller_id: string | null
          source: string
          status: string
        }
        Insert: {
          list_price_cents?: number | null
          buyer_id?: string | null
          checkout_by: string
          closed_at?: string | null
          created_at?: string
          id?: string
          is_seed?: boolean
          item_id?: string | null
          item_title?: string | null
          offer_id?: string | null
          order_id?: string | null
          price_cents: number
          reminded_24h_at?: string | null
          reminded_2h_at?: string | null
          seller_id?: string | null
          source: string
          status?: string
        }
        Update: {
          list_price_cents?: number | null
          buyer_id?: string | null
          checkout_by?: string
          closed_at?: string | null
          created_at?: string
          id?: string
          is_seed?: boolean
          item_id?: string | null
          item_title?: string | null
          offer_id?: string | null
          order_id?: string | null
          price_cents?: number
          reminded_24h_at?: string | null
          reminded_2h_at?: string | null
          seller_id?: string | null
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "declutter_cart_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "declutter_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "declutter_cart_items_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "declutter_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "declutter_cart_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "declutter_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_delivery_days_off: {
        Row: {
          created_at: string
          day: string
          seller_id: string
        }
        Insert: {
          created_at?: string
          day: string
          seller_id: string
        }
        Update: {
          created_at?: string
          day?: string
          seller_id?: string
        }
        Relationships: [
        ]
      }
      declutter_delivery_dropoffs: {
        Row: {
          address: string
          area_label: string
          buyer_id: string
          geocoded_at: string
          is_seed: boolean
          lat: number
          lng: number
          seller_id: string
        }
        Insert: {
          address: string
          area_label: string
          buyer_id: string
          geocoded_at?: string
          is_seed?: boolean
          lat: number
          lng: number
          seller_id: string
        }
        Update: {
          address?: string
          area_label?: string
          buyer_id?: string
          geocoded_at?: string
          is_seed?: boolean
          lat?: number
          lng?: number
          seller_id?: string
        }
        Relationships: [
        ]
      }
      declutter_delivery_raises: {
        Row: {
          applied_at: string | null
          card_fee_cents: number
          created_at: string
          id: string
          is_seed: boolean
          livemode: boolean | null
          order_id: string | null
          paid_at: string | null
          paid_cents: number | null
          payout_transfer_id: string | null
          raise_cents: number
          refund_attempts: number
          refund_cents: number | null
          refund_last_error: string | null
          refund_next_attempt_at: string | null
          refund_reason: string | null
          refunded_at: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          stripe_refund_ref: string | null
          task_id: string
          total_cents: number
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          card_fee_cents: number
          created_at?: string
          id?: string
          is_seed?: boolean
          livemode?: boolean | null
          order_id?: string | null
          paid_at?: string | null
          paid_cents?: number | null
          payout_transfer_id?: string | null
          raise_cents: number
          refund_attempts?: number
          refund_cents?: number | null
          refund_last_error?: string | null
          refund_next_attempt_at?: string | null
          refund_reason?: string | null
          refunded_at?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_refund_ref?: string | null
          task_id: string
          total_cents: number
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          card_fee_cents?: number
          created_at?: string
          id?: string
          is_seed?: boolean
          livemode?: boolean | null
          order_id?: string | null
          paid_at?: string | null
          paid_cents?: number | null
          payout_transfer_id?: string | null
          raise_cents?: number
          refund_attempts?: number
          refund_cents?: number | null
          refund_last_error?: string | null
          refund_next_attempt_at?: string | null
          refund_reason?: string | null
          refunded_at?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_refund_ref?: string | null
          task_id?: string
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "declutter_delivery_raises_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "declutter_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "declutter_delivery_raises_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "helpr_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_delivery_refunds: {
        Row: {
          attempts: number
          created_at: string
          executed_at: string | null
          held_notified_at: string | null
          id: string
          is_seed: boolean
          last_error: string | null
          next_attempt_at: string
          order_id: string
          reason: string
          refund_cents: number
          review_held_at: string | null
          review_reason: string | null
          settled_by_hand_cents: number | null
          settled_by_hand_note: string | null
          settled_by_hand_ref: string | null
          status: string
          stripe_payment_intent_id: string
          stripe_refund_ref: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          executed_at?: string | null
          held_notified_at?: string | null
          id?: string
          is_seed?: boolean
          last_error?: string | null
          next_attempt_at?: string
          order_id: string
          reason: string
          refund_cents: number
          review_held_at?: string | null
          review_reason?: string | null
          settled_by_hand_cents?: number | null
          settled_by_hand_note?: string | null
          settled_by_hand_ref?: string | null
          status?: string
          stripe_payment_intent_id: string
          stripe_refund_ref?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          executed_at?: string | null
          held_notified_at?: string | null
          id?: string
          is_seed?: boolean
          last_error?: string | null
          next_attempt_at?: string
          order_id?: string
          reason?: string
          refund_cents?: number
          review_held_at?: string | null
          review_reason?: string | null
          settled_by_hand_cents?: number | null
          settled_by_hand_note?: string | null
          settled_by_hand_ref?: string | null
          status?: string
          stripe_payment_intent_id?: string
          stripe_refund_ref?: string | null
        }
        Relationships: [
        ]
      }
      declutter_delivery_windows: {
        Row: {
          created_at: string
          ends_local: string
          id: string
          seller_id: string
          starts_local: string
          weekday: number
        }
        Insert: {
          created_at?: string
          ends_local: string
          id?: string
          seller_id: string
          starts_local: string
          weekday: number
        }
        Update: {
          created_at?: string
          ends_local?: string
          id?: string
          seller_id?: string
          starts_local?: string
          weekday?: number
        }
        Relationships: [
        ]
      }
      declutter_donation_partners: {
        Row: {
          active: boolean
          address: string
          created_at: string
          created_by: string | null
          id: string
          lat: number
          lng: number
          name: string
          parish: string
          takes: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          address: string
          created_at?: string
          created_by?: string | null
          id?: string
          lat: number
          lng: number
          name: string
          parish: string
          takes?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string
          created_at?: string
          created_by?: string | null
          id?: string
          lat?: number
          lng?: number
          name?: string
          parish?: string
          takes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      declutter_donations: {
        Row: {
          chosen_at: string
          donated_at: string | null
          item_id: string
          job_id: string | null
          partner_address: string
          partner_id: string | null
          partner_name: string
        }
        Insert: {
          chosen_at?: string
          donated_at?: string | null
          item_id: string
          job_id?: string | null
          partner_address: string
          partner_id?: string | null
          partner_name: string
        }
        Update: {
          chosen_at?: string
          donated_at?: string | null
          item_id?: string
          job_id?: string | null
          partner_address?: string
          partner_id?: string | null
          partner_name?: string
        }
        Relationships: []
      }
      declutter_fee_debt_deductions: {
        Row: {
          deducted_cents: number
          created_at: string
          debt_id: string
          id: string
          payout_ref: string
        }
        Insert: {
          deducted_cents: number
          created_at?: string
          debt_id: string
          id?: string
          payout_ref: string
        }
        Update: {
          deducted_cents?: number
          created_at?: string
          debt_id?: string
          id?: string
          payout_ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "declutter_fee_debt_deductions_debt_id_fkey"
            columns: ["debt_id"]
            isOneToOne: false
            referencedRelation: "declutter_seller_fee_debts"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_hand_refunds: {
        Row: {
          amount_cents: number
          created_at: string
          failed_at: string | null
          livemode: boolean
          order_id: string | null
          hand_outcome: string
          refund_row_id: string | null
          stripe_payment_intent_id: string
          stripe_refund_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          failed_at?: string | null
          livemode: boolean
          order_id?: string | null
          hand_outcome: string
          refund_row_id?: string | null
          stripe_payment_intent_id: string
          stripe_refund_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          failed_at?: string | null
          livemode?: boolean
          order_id?: string | null
          hand_outcome?: string
          refund_row_id?: string | null
          stripe_payment_intent_id?: string
          stripe_refund_id?: string
        }
        Relationships: []
      }
      declutter_handover_talk_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          sender_id: string
          talk_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          sender_id: string
          talk_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          sender_id?: string
          talk_id?: string
        }
        Relationships: []
      }
      declutter_handover_talks: {
        Row: {
          buyer_id: string
          buyer_notified_at: string | null
          closed_at: string | null
          expires_at: string
          id: string
          opened_at: string
          opened_by: string
          seller_id: string
          seller_notified_at: string | null
        }
        Insert: {
          buyer_id: string
          buyer_notified_at?: string | null
          closed_at?: string | null
          expires_at: string
          id?: string
          opened_at?: string
          opened_by: string
          seller_id: string
          seller_notified_at?: string | null
        }
        Update: {
          buyer_id?: string
          buyer_notified_at?: string | null
          closed_at?: string | null
          expires_at?: string
          id?: string
          opened_at?: string
          opened_by?: string
          seller_id?: string
          seller_notified_at?: string | null
        }
        Relationships: []
      }
      declutter_handovers: {
        Row: {
          set_out_distance_m: number | null
          code: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          order_id: string
          picked_up_at: string | null
          picked_up_distance_m: number | null
          picked_up_photo_path: string | null
          set_out_at: string | null
          set_out_photo_path: string | null
          set_out_note: string | null
          seller_confirmed_at: string | null
          no_show_reported_at: string | null
          no_show_answer_by: string | null
          held_nudged_at: string | null
          wrong_attempts: number
        }
        Insert: {
          set_out_distance_m?: number | null
          code: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          order_id: string
          picked_up_at?: string | null
          picked_up_distance_m?: number | null
          picked_up_photo_path?: string | null
          set_out_at?: string | null
          set_out_photo_path?: string | null
          set_out_note?: string | null
          seller_confirmed_at?: string | null
          no_show_reported_at?: string | null
          no_show_answer_by?: string | null
          held_nudged_at?: string | null
          wrong_attempts?: number
        }
        Update: {
          set_out_distance_m?: number | null
          code?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          order_id?: string
          picked_up_at?: string | null
          picked_up_distance_m?: number | null
          picked_up_photo_path?: string | null
          set_out_at?: string | null
          set_out_photo_path?: string | null
          set_out_note?: string | null
          seller_confirmed_at?: string | null
          no_show_reported_at?: string | null
          no_show_answer_by?: string | null
          held_nudged_at?: string | null
          wrong_attempts?: number
        }
        Relationships: [
          {
            foreignKeyName: "declutter_handovers_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "declutter_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_haul_away_notices: {
        Row: {
          item_id: string
          notified_at: string
        }
        Insert: {
          item_id: string
          notified_at?: string
        }
        Update: {
          item_id?: string
          notified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "declutter_haul_away_notices_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "declutter_items"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_haul_aways: {
        Row: {
          created_at: string
          item_id: string
          job_id: string | null
          prior_status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          item_id: string
          job_id?: string | null
          prior_status: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          item_id?: string
          job_id?: string | null
          prior_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "declutter_haul_aways_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "declutter_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "declutter_haul_aways_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_item_no_seller_delivery: {
        Row: {
          created_at: string
          item_id: string
          seller_id: string
        }
        Insert: {
          created_at?: string
          item_id: string
          seller_id: string
        }
        Update: {
          created_at?: string
          item_id?: string
          seller_id?: string
        }
        Relationships: [
        ]
      }
      declutter_item_photos: {
        Row: {
          created_at: string
          id: string
          item_id: string
          position: number
          seller_id: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          position: number
          seller_id: string
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          position?: number
          seller_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "declutter_item_photos_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "declutter_items"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_item_price_drops: {
        Row: {
          at: string
          from_cents: number
          item_id: string
          to_cents: number
        }
        Insert: {
          at?: string
          from_cents: number
          item_id: string
          to_cents: number
        }
        Update: {
          at?: string
          from_cents?: number
          item_id?: string
          to_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "declutter_item_price_drops_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "declutter_items"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_item_private: {
        Row: {
          auto_free_day12: boolean
          auto_free_days: number | null
          ai_check_attempts: number
          ai_check_cleared_at: string | null
          ai_check_last_try_at: string | null
          ai_check_overdue_alerted_at: string | null
          ai_checked_at: string | null
          ai_flag_reason: string | null
          auto_offers: boolean
          drop_stop_cents: number | null
          drops_stopped: boolean
          floor_price_cents: number
          item_id: string
          keep_up_until_sold: boolean
          move_out_on: string | null
          sale_name: string | null
          sale_starts_on: string | null
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          review_note: string | null
          seller_id: string
          updated_at: string
        }
        Insert: {
          auto_free_day12?: boolean
          auto_free_days?: number | null
          ai_check_attempts?: number
          ai_check_cleared_at?: string | null
          ai_check_last_try_at?: string | null
          ai_check_overdue_alerted_at?: string | null
          ai_checked_at?: string | null
          ai_flag_reason?: string | null
          auto_offers?: boolean
          drop_stop_cents?: number | null
          drops_stopped?: boolean
          floor_price_cents: number
          item_id: string
          keep_up_until_sold?: boolean
          move_out_on?: string | null
          sale_name?: string | null
          sale_starts_on?: string | null
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          review_note?: string | null
          seller_id: string
          updated_at?: string
        }
        Update: {
          auto_free_day12?: boolean
          auto_free_days?: number | null
          ai_check_attempts?: number
          ai_check_cleared_at?: string | null
          ai_check_last_try_at?: string | null
          ai_check_overdue_alerted_at?: string | null
          ai_checked_at?: string | null
          ai_flag_reason?: string | null
          auto_offers?: boolean
          drop_stop_cents?: number | null
          drops_stopped?: boolean
          floor_price_cents?: number
          item_id?: string
          keep_up_until_sold?: boolean
          move_out_on?: string | null
          sale_name?: string | null
          sale_starts_on?: string | null
          pickup_address?: string
          pickup_lat?: number
          pickup_lng?: number
          review_note?: string | null
          seller_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "declutter_item_private_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "declutter_items"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_items: {
        Row: {
          accepts_offers: boolean
          admin_approved_at: string | null
          area_label: string
          area_lat: number
          area_lng: number
          category: string
          condition_stars: number
          created_at: string
          current_price_cents: number
          delivery_size: string
          description: string
          handovers: string[] | null
          drop_pct: number
          drops_stopped: boolean
          ends_at: string | null
          id: string
          is_seed: boolean
          last_price_drop_on: string | null
          live_at: string | null
          listed_until: string | null
          in_moving_sale: boolean
          porch_ok: boolean
          price_cents: number
          price_dropped_at: string | null
          relist_count: number
          round_nudged: number | null
          sale_mode: string
          seller_hidden: boolean
          seller_id: string
          ship_preset: string | null
          status: string
          submitted_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          accepts_offers?: boolean
          admin_approved_at?: string | null
          area_label: string
          area_lat: number
          area_lng: number
          category: string
          condition_stars: number
          created_at?: string
          current_price_cents: number
          delivery_size: string
          description?: string
          handovers?: string[] | null
          drop_pct?: number
          drops_stopped?: boolean
          ends_at?: string | null
          id?: string
          is_seed?: boolean
          last_price_drop_on?: string | null
          live_at?: string | null
          listed_until?: string | null
          in_moving_sale?: boolean
          porch_ok?: boolean
          price_cents: number
          price_dropped_at?: string | null
          relist_count?: number
          round_nudged?: number | null
          sale_mode?: string
          seller_hidden?: boolean
          seller_id: string
          ship_preset?: string | null
          status?: string
          submitted_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          accepts_offers?: boolean
          admin_approved_at?: string | null
          area_label?: string
          area_lat?: number
          area_lng?: number
          category?: string
          condition_stars?: number
          created_at?: string
          current_price_cents?: number
          delivery_size?: string
          description?: string
          handovers?: string[] | null
          drop_pct?: number
          drops_stopped?: boolean
          ends_at?: string | null
          id?: string
          is_seed?: boolean
          last_price_drop_on?: string | null
          live_at?: string | null
          listed_until?: string | null
          in_moving_sale?: boolean
          porch_ok?: boolean
          price_cents?: number
          price_dropped_at?: string | null
          relist_count?: number
          round_nudged?: number | null
          sale_mode?: string
          seller_hidden?: boolean
          seller_id?: string
          ship_preset?: string | null
          status?: string
          submitted_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      declutter_listed_for_seller: {
        Row: {
          created_at: string
          decided_at: string | null
          helpr_id: string
          item_id: string
          job_id: string
          sent_at: string | null
          seller_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          helpr_id: string
          item_id: string
          job_id: string
          sent_at?: string | null
          seller_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          helpr_id?: string
          item_id?: string
          job_id?: string
          sent_at?: string | null
          seller_id?: string
        }
        Relationships: []
      }
      declutter_meetup_choices: {
        Row: {
          buyer_id: string
          chosen_at: string
          seller_id: string
          spot_id: string
        }
        Insert: {
          buyer_id: string
          chosen_at?: string
          seller_id: string
          spot_id: string
        }
        Update: {
          buyer_id?: string
          chosen_at?: string
          seller_id?: string
          spot_id?: string
        }
        Relationships: []
      }
      declutter_meetup_spots: {
        Row: {
          active: boolean
          address: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          lat: number
          lng: number
          name: string
          note: string | null
          parish: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          address: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          lat: number
          lng: number
          name: string
          note?: string | null
          parish: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          lat?: number
          lng?: number
          name?: string
          note?: string | null
          parish?: string
          updated_at?: string
        }
        Relationships: []
      }
      declutter_offer_events: {
        Row: {
          action: string
          actor_side: string
          amount_cents: number | null
          created_at: string
          id: string
          offer_id: string
        }
        Insert: {
          action: string
          actor_side: string
          amount_cents?: number | null
          created_at?: string
          id?: string
          offer_id: string
        }
        Update: {
          action?: string
          actor_side?: string
          amount_cents?: number | null
          created_at?: string
          id?: string
          offer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "declutter_offer_events_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "declutter_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_offers: {
        Row: {
          amount_cents: number
          awaiting: string
          buyer_id: string
          closed_at: string | null
          counter_count: number
          created_at: string
          id: string
          is_seed: boolean
          item_id: string
          respond_by: string
          seller_id: string
          status: string
          updated_at: string
          voided_by_line: string | null
          wanted_id: string | null
        }
        Insert: {
          amount_cents: number
          awaiting: string
          buyer_id: string
          closed_at?: string | null
          counter_count?: number
          created_at?: string
          id?: string
          is_seed?: boolean
          item_id: string
          respond_by: string
          seller_id: string
          status?: string
          updated_at?: string
          voided_by_line?: string | null
          wanted_id?: string | null
        }
        Update: {
          amount_cents?: number
          awaiting?: string
          buyer_id?: string
          closed_at?: string | null
          counter_count?: number
          created_at?: string
          id?: string
          is_seed?: boolean
          item_id?: string
          respond_by?: string
          seller_id?: string
          status?: string
          updated_at?: string
          voided_by_line?: string | null
          wanted_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "declutter_offers_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "declutter_items"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_order_deliveries: {
        Row: {
          created_at: string
          delivery_cents: number
          dropoff_address: string
          dropoff_area: string
          dropoff_lat: number
          dropoff_lng: number
          is_seed: boolean
          order_id: string
          road_miles: number
          size: string
          task_id: string | null
        }
        Insert: {
          created_at?: string
          delivery_cents: number
          dropoff_address: string
          dropoff_area: string
          dropoff_lat: number
          dropoff_lng: number
          is_seed?: boolean
          order_id: string
          road_miles: number
          size: string
          task_id?: string | null
        }
        Update: {
          created_at?: string
          delivery_cents?: number
          dropoff_address?: string
          dropoff_area?: string
          dropoff_lat?: number
          dropoff_lng?: number
          is_seed?: boolean
          order_id?: string
          road_miles?: number
          size?: string
          task_id?: string | null
        }
        Relationships: [
        ]
      }
      declutter_order_jobs: {
        Row: {
          created_at: string
          job_id: string
          order_id: string | null
          purpose: string
          seller_fault_at: string | null
          seller_fault_refund_id: string | null
          seller_fee_billed_cents: number | null
        }
        Insert: {
          created_at?: string
          job_id: string
          order_id?: string | null
          purpose: string
          seller_fault_at?: string | null
          seller_fault_refund_id?: string | null
          seller_fee_billed_cents?: number | null
        }
        Update: {
          created_at?: string
          job_id?: string
          order_id?: string | null
          purpose?: string
          seller_fault_at?: string | null
          seller_fault_refund_id?: string | null
          seller_fee_billed_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "declutter_order_jobs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "declutter_order_jobs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "declutter_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "declutter_order_jobs_seller_fault_refund_id_fkey"
            columns: ["seller_fault_refund_id"]
            isOneToOne: false
            referencedRelation: "declutter_refunds"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_order_meetups: {
        Row: {
          buyer_here_at: string | null
          created_at: string
          order_id: string
          seller_here_at: string | null
          spot_address: string
          spot_id: string | null
          spot_lat: number
          spot_lng: number
          spot_name: string
        }
        Insert: {
          buyer_here_at?: string | null
          created_at?: string
          order_id: string
          seller_here_at?: string | null
          spot_address: string
          spot_id?: string | null
          spot_lat: number
          spot_lng: number
          spot_name: string
        }
        Update: {
          buyer_here_at?: string | null
          created_at?: string
          order_id?: string
          seller_here_at?: string | null
          spot_address?: string
          spot_id?: string | null
          spot_lat?: number
          spot_lng?: number
          spot_name?: string
        }
        Relationships: []
      }
      declutter_order_porch_places: {
        Row: {
          address: string | null
          area: string | null
          frozen_at: string
          label: string | null
          lat: number | null
          lng: number | null
          order_id: string
          place_id: string | null
          seller_id: string | null
          weekdays: number[]
          windows: Json | null
        }
        Insert: {
          address?: string | null
          area?: string | null
          frozen_at?: string
          label?: string | null
          lat?: number | null
          lng?: number | null
          order_id: string
          place_id?: string | null
          seller_id?: string | null
          weekdays: number[]
          windows?: Json | null
        }
        Update: {
          address?: string | null
          area?: string | null
          frozen_at?: string
          label?: string | null
          lat?: number | null
          lng?: number | null
          order_id?: string
          place_id?: string | null
          seller_id?: string | null
          weekdays?: number[]
          windows?: Json | null
        }
        Relationships: []
      }
      helpr_task_talk_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          sender_id: string | null
          sender_side: string
          task_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          sender_id?: string | null
          sender_side: string
          task_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          sender_id?: string | null
          sender_side?: string
          task_id?: string
        }
        Relationships: []
      }
      declutter_order_talk_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          sender_id: string | null
          sender_side: string
          talk_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          sender_id?: string | null
          sender_side: string
          talk_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          sender_id?: string | null
          sender_side?: string
          talk_id?: string
        }
        Relationships: []
      }
      declutter_order_talks: {
        Row: {
          buyer_notified_at: string | null
          created_at: string
          id: string
          order_id: string
          seller_notified_at: string | null
        }
        Insert: {
          buyer_notified_at?: string | null
          created_at?: string
          id?: string
          order_id: string
          seller_notified_at?: string | null
        }
        Update: {
          buyer_notified_at?: string | null
          created_at?: string
          id?: string
          order_id?: string
          seller_notified_at?: string | null
        }
        Relationships: []
      }
      declutter_orders: {
        Row: {
          bundle_discount_cents: number
          delivery_cents: number
          shipping_cents: number
          buyer_id: string | null
          card_fee_cents: number | null
          close_reason: string | null
          closed_at: string | null
          created_at: string
          fee_rule: string
          handed_over_at: string | null
          handover: string
          id: string
          is_seed: boolean
          items_cents: number
          paid_at: string | null
          paid_with: string
          premium_cents: number
          setup_fee_cents: number
          setup_fee_refund_id: string | null
          setup_fee_state: string | null
          seller_id: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_paid_at: string | null
          stripe_payment_intent_id: string | null
          tax_cents: number
          total_cents: number
        }
        Insert: {
          bundle_discount_cents?: number
          delivery_cents?: number
          shipping_cents?: number
          buyer_id?: string | null
          card_fee_cents?: number | null
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          fee_rule?: string
          handed_over_at?: string | null
          handover: string
          id?: string
          is_seed?: boolean
          items_cents: number
          paid_at?: string | null
          paid_with?: string
          premium_cents: number
          setup_fee_cents?: number
          setup_fee_refund_id?: string | null
          setup_fee_state?: string | null
          seller_id?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          tax_cents?: number
          total_cents: number
        }
        Update: {
          bundle_discount_cents?: number
          delivery_cents?: number
          shipping_cents?: number
          buyer_id?: string | null
          card_fee_cents?: number | null
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          fee_rule?: string
          handed_over_at?: string | null
          handover?: string
          id?: string
          is_seed?: boolean
          items_cents?: number
          paid_at?: string | null
          paid_with?: string
          premium_cents?: number
          setup_fee_cents?: number
          setup_fee_refund_id?: string | null
          setup_fee_state?: string | null
          seller_id?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          tax_cents?: number
          total_cents?: number
        }
        Relationships: [
        ]
      }
      declutter_payouts: {
        Row: {
          amount_cents: number
          delivery_cents: number
          attempts: number
          created_at: string
          debt_cents: number
          executed_at: string | null
          held_notified_at: string | null
          id: string
          is_seed: boolean
          items_cents: number
          refunded_cents: number
          last_error: string | null
          next_attempt_at: string
          order_id: string
          review_held_at: string | null
          review_reason: string | null
          seller_id: string | null
          settled_by_hand_cents: number | null
          settled_by_hand_note: string | null
          settled_by_hand_ref: string | null
          send_tried: boolean
          setup_fee_cents: number
          status: string
          stripe_transfer_id: string | null
        }
        Insert: {
          amount_cents: number
          delivery_cents?: number
          attempts?: number
          created_at?: string
          debt_cents: number
          executed_at?: string | null
          held_notified_at?: string | null
          id?: string
          is_seed?: boolean
          items_cents: number
          last_error?: string | null
          refunded_cents?: number
          next_attempt_at?: string
          order_id: string
          review_held_at?: string | null
          review_reason?: string | null
          seller_id?: string | null
          settled_by_hand_cents?: number | null
          settled_by_hand_note?: string | null
          settled_by_hand_ref?: string | null
          send_tried?: boolean
          setup_fee_cents?: number
          status: string
          stripe_transfer_id?: string | null
        }
        Update: {
          amount_cents?: number
          delivery_cents?: number
          attempts?: number
          created_at?: string
          debt_cents?: number
          executed_at?: string | null
          held_notified_at?: string | null
          id?: string
          is_seed?: boolean
          items_cents?: number
          refunded_cents?: number
          last_error?: string | null
          next_attempt_at?: string
          order_id?: string
          review_held_at?: string | null
          review_reason?: string | null
          seller_id?: string | null
          settled_by_hand_cents?: number | null
          settled_by_hand_note?: string | null
          settled_by_hand_ref?: string | null
          send_tried?: boolean
          setup_fee_cents?: number
          status?: string
          stripe_transfer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "declutter_payouts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "declutter_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_pickup_windows: {
        Row: {
          created_at: string
          ends_local: string
          id: string
          seller_id: string
          starts_local: string
          weekday: number
        }
        Insert: {
          created_at?: string
          ends_local: string
          id?: string
          seller_id: string
          starts_local: string
          weekday: number
        }
        Update: {
          created_at?: string
          ends_local?: string
          id?: string
          seller_id?: string
          starts_local?: string
          weekday?: number
        }
        Relationships: []
      }
      declutter_pin_secret: {
        Row: {
          created_at: string
          id: number
          salt: string
        }
        Insert: {
          created_at?: string
          id?: number
          salt: string
        }
        Update: {
          created_at?: string
          id?: number
          salt?: string
        }
        Relationships: []
      }
      declutter_porch_place_choices: {
        Row: {
          buyer_id: string
          chosen_at: string
          place_id: string
          seller_id: string
        }
        Insert: {
          buyer_id: string
          chosen_at?: string
          place_id: string
          seller_id: string
        }
        Update: {
          buyer_id?: string
          chosen_at?: string
          place_id?: string
          seller_id?: string
        }
        Relationships: []
      }
      declutter_porch_places: {
        Row: {
          address: string
          area: string
          created_at: string
          id: string
          label: string
          lat: number
          lng: number
          position: number
          seller_id: string
          updated_at: string
          weekdays: number[]
          windows: Json | null
        }
        Insert: {
          address: string
          area: string
          created_at?: string
          id?: string
          label: string
          lat: number
          lng: number
          position: number
          seller_id: string
          updated_at?: string
          weekdays: number[]
          windows?: Json | null
        }
        Update: {
          address?: string
          area?: string
          created_at?: string
          id?: string
          label?: string
          lat?: number
          lng?: number
          position?: number
          seller_id?: string
          updated_at?: string
          weekdays?: number[]
          windows?: Json | null
        }
        Relationships: []
      }
      declutter_price_alerts: {
        Row: {
          id: number
          item_id: string
          price_cents: number
          sent_at: string
          user_id: string
        }
        Insert: {
          id?: number
          item_id: string
          price_cents: number
          sent_at?: string
          user_id: string
        }
        Update: {
          id?: number
          item_id?: string
          price_cents?: number
          sent_at?: string
          user_id?: string
        }
        Relationships: [
        ]
      }
      declutter_move_reminders: {
        Row: {
          kind: string
          move_out_on: string
          notified_at: string
          seller_id: string
        }
        Insert: {
          kind: string
          move_out_on: string
          notified_at?: string
          seller_id: string
        }
        Update: {
          kind?: string
          move_out_on?: string
          notified_at?: string
          seller_id?: string
        }
        Relationships: []
      }
      declutter_price_nudges: {
        Row: {
          item_id: string
          notified_at: string
        }
        Insert: {
          item_id: string
          notified_at?: string
        }
        Update: {
          item_id?: string
          notified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "declutter_price_nudges_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "declutter_items"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_problems: {
        Row: {
          other_side_at: string | null
          other_side_note: string | null
          other_side_photo_paths: string[]
          admin_note: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision: string | null
          fault: string | null
          id: string
          is_seed: boolean
          note: string
          order_id: string
          photo_paths: string[]
          reason: string
          reporter_id: string | null
          reporter_side: string
          status: string
          strike_given: boolean
          withdrawn_at: string | null
        }
        Insert: {
          other_side_at?: string | null
          other_side_note?: string | null
          other_side_photo_paths?: string[]
          admin_note?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          fault?: string | null
          id?: string
          is_seed?: boolean
          note: string
          order_id: string
          photo_paths?: string[]
          reason: string
          reporter_id?: string | null
          reporter_side: string
          status?: string
          strike_given?: boolean
          withdrawn_at?: string | null
        }
        Update: {
          other_side_at?: string | null
          other_side_note?: string | null
          other_side_photo_paths?: string[]
          admin_note?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          fault?: string | null
          id?: string
          is_seed?: boolean
          note?: string
          order_id?: string
          photo_paths?: string[]
          reason?: string
          reporter_id?: string | null
          reporter_side?: string
          status?: string
          strike_given?: boolean
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "declutter_problems_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "declutter_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_questions: {
        Row: {
          answer: string | null
          answered_at: string | null
          asker_id: string
          created_at: string
          id: string
          item_id: string
          question: string
          removed_at: string | null
        }
        Insert: {
          answer?: string | null
          answered_at?: string | null
          asker_id: string
          created_at?: string
          id?: string
          item_id: string
          question: string
          removed_at?: string | null
        }
        Update: {
          answer?: string | null
          answered_at?: string | null
          asker_id?: string
          created_at?: string
          id?: string
          item_id?: string
          question?: string
          removed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "declutter_questions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "declutter_items"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_refund_requests: {
        Row: {
          photo_paths: string[]
          answer_by: string
          created_at: string
          declined_at: string | null
          return_agreed_at: string | null
          return_by: string | null
          returned_at: string | null
          return_address: string | null
          return_at: string | null
          return_day: string | null
          return_dropped_off_at: string | null
          return_lat: number | null
          return_lng: number | null
          return_photo_path: string | null
          return_way: string | null
          returned_photo_path: string | null
          id: string
          is_seed: boolean
          note: string
          offer_answer_by: string | null
          offer_cents: number | null
          offered_at: string | null
          order_id: string
          problem_id: string | null
          reason: string
          refund_id: string | null
          settled_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          photo_paths?: string[]
          answer_by: string
          created_at?: string
          declined_at?: string | null
          return_agreed_at?: string | null
          return_by?: string | null
          returned_at?: string | null
          return_address?: string | null
          return_at?: string | null
          return_day?: string | null
          return_dropped_off_at?: string | null
          return_lat?: number | null
          return_lng?: number | null
          return_photo_path?: string | null
          return_way?: string | null
          returned_photo_path?: string | null
          id?: string
          is_seed?: boolean
          note: string
          offer_answer_by?: string | null
          offer_cents?: number | null
          offered_at?: string | null
          order_id: string
          problem_id?: string | null
          reason: string
          refund_id?: string | null
          settled_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          photo_paths?: string[]
          answer_by?: string
          created_at?: string
          declined_at?: string | null
          return_agreed_at?: string | null
          return_by?: string | null
          returned_at?: string | null
          return_address?: string | null
          return_at?: string | null
          return_day?: string | null
          return_dropped_off_at?: string | null
          return_lat?: number | null
          return_lng?: number | null
          return_photo_path?: string | null
          return_way?: string | null
          returned_photo_path?: string | null
          id?: string
          is_seed?: boolean
          note?: string
          offer_answer_by?: string | null
          offer_cents?: number | null
          offered_at?: string | null
          order_id?: string
          problem_id?: string | null
          reason?: string
          refund_id?: string | null
          settled_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "declutter_refund_requests_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "declutter_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "declutter_refund_requests_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "declutter_problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "declutter_refund_requests_refund_id_fkey"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "declutter_refunds"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_refunds: {
        Row: {
          attempts: number
          card_fee_cents: number
          created_at: string
          executed_at: string | null
          fee_policy: string
          gave_up_notified_at: string | null
          held_notified_at: string | null
          id: string
          is_seed: boolean
          kept_cents: number
          last_error: string | null
          payment_livemode: boolean | null
          next_attempt_at: string
          order_id: string | null
          paid_cents: number
          reason: string
          refund_cents: number
          review_held_at: string | null
          review_reason: string | null
          settled_by_hand_cents: number | null
          settled_by_hand_note: string | null
          settled_by_hand_ref: string | null
          status: string
          stripe_payment_intent_id: string
          stripe_refund_ref: string | null
        }
        Insert: {
          attempts?: number
          card_fee_cents: number
          created_at?: string
          executed_at?: string | null
          fee_policy: string
          gave_up_notified_at?: string | null
          held_notified_at?: string | null
          id?: string
          is_seed?: boolean
          kept_cents?: number
          last_error?: string | null
          payment_livemode?: boolean | null
          next_attempt_at?: string
          order_id?: string | null
          paid_cents: number
          reason: string
          refund_cents: number
          review_held_at?: string | null
          review_reason?: string | null
          settled_by_hand_cents?: number | null
          settled_by_hand_note?: string | null
          settled_by_hand_ref?: string | null
          status?: string
          stripe_payment_intent_id: string
          stripe_refund_ref?: string | null
        }
        Update: {
          attempts?: number
          card_fee_cents?: number
          created_at?: string
          executed_at?: string | null
          fee_policy?: string
          gave_up_notified_at?: string | null
          held_notified_at?: string | null
          id?: string
          is_seed?: boolean
          kept_cents?: number
          last_error?: string | null
          payment_livemode?: boolean | null
          next_attempt_at?: string
          order_id?: string | null
          paid_cents?: number
          reason?: string
          refund_cents?: number
          review_held_at?: string | null
          review_reason?: string | null
          settled_by_hand_cents?: number | null
          settled_by_hand_note?: string | null
          settled_by_hand_ref?: string | null
          status?: string
          stripe_payment_intent_id?: string
          stripe_refund_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "declutter_refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "declutter_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_reviews: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          is_seed: boolean
          order_id: string
          reviewee_id: string | null
          reviewer_id: string | null
          reviewer_side: string
          stars: number
          tags: string[]
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          is_seed?: boolean
          order_id: string
          reviewee_id?: string | null
          reviewer_id?: string | null
          reviewer_side: string
          stars: number
          tags?: string[]
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          is_seed?: boolean
          order_id?: string
          reviewee_id?: string | null
          reviewer_id?: string | null
          reviewer_side?: string
          stars?: number
          tags?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "declutter_reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "declutter_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_seller_deliveries: {
        Row: {
          buyer_id: string
          buyer_proposals: number
          created_at: string
          delivered_at: string | null
          dropoff_address: string
          dropoff_area: string
          dropoff_lat: number
          dropoff_lng: number
          handoff: string
          held_until: string | null
          is_seed: boolean
          order_id: string
          proposed_at: string | null
          proposed_by: string | null
          proposed_start: string | null
          reminded_hours: number[]
          seller_id: string
          seller_proposals: number
          slot_end: string | null
          slot_start: string | null
          status: string
          updated_at: string
        }
        Insert: {
          buyer_id: string
          buyer_proposals?: number
          created_at?: string
          delivered_at?: string | null
          dropoff_address: string
          dropoff_area: string
          dropoff_lat: number
          dropoff_lng: number
          handoff?: string
          held_until?: string | null
          is_seed?: boolean
          order_id: string
          proposed_at?: string | null
          proposed_by?: string | null
          proposed_start?: string | null
          reminded_hours?: number[]
          seller_id: string
          seller_proposals?: number
          slot_end?: string | null
          slot_start?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          buyer_id?: string
          buyer_proposals?: number
          created_at?: string
          delivered_at?: string | null
          dropoff_address?: string
          dropoff_area?: string
          dropoff_lat?: number
          dropoff_lng?: number
          handoff?: string
          held_until?: string | null
          is_seed?: boolean
          order_id?: string
          proposed_at?: string | null
          proposed_by?: string | null
          proposed_start?: string | null
          reminded_hours?: number[]
          seller_id?: string
          seller_proposals?: number
          slot_end?: string | null
          slot_start?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      declutter_seller_delivery: {
        Row: {
          created_at: string
          enabled: boolean
          free_over_cents: number | null
          is_seed: boolean
          radius_miles: number
          rate_cents: number
          seller_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          free_over_cents?: number | null
          is_seed?: boolean
          radius_miles: number
          rate_cents: number
          seller_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          free_over_cents?: number | null
          is_seed?: boolean
          radius_miles?: number
          rate_cents?: number
          seller_id?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      declutter_seller_fee_debts: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          is_seed: boolean
          refund_id: string | null
          raise_id: string | null
          remaining_cents: number
          seller_id: string
          shop_refund_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          is_seed?: boolean
          refund_id?: string | null
          raise_id?: string | null
          remaining_cents: number
          seller_id: string
          shop_refund_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          is_seed?: boolean
          refund_id?: string | null
          raise_id?: string | null
          remaining_cents?: number
          seller_id?: string
          shop_refund_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "declutter_seller_fee_debts_refund_id_fkey"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "declutter_refunds"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_seller_flags: {
        Row: {
          business_like: boolean
          reason: string | null
          set_at: string
          set_by: string | null
          user_id: string
        }
        Insert: {
          business_like?: boolean
          reason?: string | null
          set_at?: string
          set_by?: string | null
          user_id: string
        }
        Update: {
          business_like?: boolean
          reason?: string | null
          set_at?: string
          set_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      declutter_seller_defaults: {
        Row: {
          accepts_offers: boolean
          drop_pct: number
          drops: boolean
          floor_pct: number
          free_after_days: number | null
          handovers: string[]
          keep_up: boolean
          member_id: string
          updated_at: string
        }
        Insert: {
          accepts_offers?: boolean
          drop_pct?: number
          drops?: boolean
          floor_pct?: number
          free_after_days?: number | null
          handovers?: string[]
          keep_up?: boolean
          member_id: string
          updated_at?: string
        }
        Update: {
          accepts_offers?: boolean
          drop_pct?: number
          drops?: boolean
          floor_pct?: number
          free_after_days?: number | null
          handovers?: string[]
          keep_up?: boolean
          member_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      declutter_seller_porch_days: {
        Row: {
          seller_id: string
          updated_at: string
          weekdays: number[]
        }
        Insert: {
          seller_id: string
          updated_at?: string
          weekdays: number[]
        }
        Update: {
          seller_id?: string
          updated_at?: string
          weekdays?: number[]
        }
        Relationships: []
      }
      declutter_strikes: {
        Row: {
          appeal_decided_at: string | null
          appeal_decided_by: string | null
          appeal_decision: string | null
          appeal_note: string | null
          appeal_photo_path: string | null
          appealed_at: string | null
          cart_line_id: string | null
          expires_at: string
          given_at: string
          id: string
          item_id: string | null
          offender_side: string
          reason: string
          removed_at: string | null
          removed_by: string | null
          user_id: string
        }
        Insert: {
          appeal_decided_at?: string | null
          appeal_decided_by?: string | null
          appeal_decision?: string | null
          appeal_note?: string | null
          appeal_photo_path?: string | null
          appealed_at?: string | null
          cart_line_id?: string | null
          expires_at: string
          given_at?: string
          id?: string
          item_id?: string | null
          offender_side: string
          reason: string
          removed_at?: string | null
          removed_by?: string | null
          user_id: string
        }
        Update: {
          appeal_decided_at?: string | null
          appeal_decided_by?: string | null
          appeal_decision?: string | null
          appeal_note?: string | null
          appeal_photo_path?: string | null
          appealed_at?: string | null
          cart_line_id?: string | null
          expires_at?: string
          given_at?: string
          id?: string
          item_id?: string | null
          offender_side?: string
          reason?: string
          removed_at?: string | null
          removed_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "declutter_strikes_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "declutter_items"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_tax_attestations: {
        Row: {
          attested_at: string
          bought_for_personal_use: boolean
          item_id: string
          keeps_item_until_handover: boolean
          not_a_frequent_seller: boolean
          not_in_the_business: boolean
          seller_id: string
          wording_version: string
        }
        Insert: {
          attested_at?: string
          bought_for_personal_use: boolean
          item_id: string
          keeps_item_until_handover: boolean
          not_a_frequent_seller: boolean
          not_in_the_business: boolean
          seller_id: string
          wording_version?: string
        }
        Update: {
          attested_at?: string
          bought_for_personal_use?: boolean
          item_id?: string
          keeps_item_until_handover?: boolean
          not_a_frequent_seller?: boolean
          not_in_the_business?: boolean
          seller_id?: string
          wording_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "declutter_tax_attestations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "declutter_items"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_wanted: {
        Row: {
          area_lat: number
          area_lng: number
          category: string
          closed_at: string | null
          expiry_told_at: string | null
          created_at: string
          expires_at: string
          id: string
          is_seed: boolean
          max_price_cents: number
          photo_added_at: string | null
          photo_paths: string[]
          photos_cleared: string[]
          photos_held: string[]
          public: boolean
          radius_miles: number
          removed_at: string | null
          status: string
          user_id: string
          what: string
        }
        Insert: {
          area_lat: number
          area_lng: number
          category: string
          closed_at?: string | null
          expiry_told_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          is_seed?: boolean
          max_price_cents: number
          photo_added_at?: string | null
          photo_paths?: string[]
          photos_cleared?: string[]
          photos_held?: string[]
          public?: boolean
          radius_miles: number
          removed_at: string | null
          status?: string
          user_id: string
          what: string
        }
        Update: {
          area_lat?: number
          area_lng?: number
          category?: string
          closed_at?: string | null
          expiry_told_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          is_seed?: boolean
          max_price_cents?: number
          photo_added_at?: string | null
          photo_paths?: string[]
          photos_cleared?: string[]
          photos_held?: string[]
          public?: boolean
          radius_miles?: number
          removed_at?: string | null
          status?: string
          user_id?: string
          what?: string
        }
        Relationships: []
      }
      declutter_wanted_matches: {
        Row: {
          created_at: string
          item_id: string
          poster_notified_at: string | null
          seller_notified_at: string | null
          wanted_id: string
        }
        Insert: {
          created_at?: string
          item_id: string
          poster_notified_at?: string | null
          seller_notified_at?: string | null
          wanted_id: string
        }
        Update: {
          created_at?: string
          item_id?: string
          poster_notified_at?: string | null
          seller_notified_at?: string | null
          wanted_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "declutter_wanted_matches_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "declutter_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "declutter_wanted_matches_wanted_id_fkey"
            columns: ["wanted_id"]
            isOneToOne: false
            referencedRelation: "declutter_wanted"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_wanted_queue: {
        Row: {
          attempts: number
          item_id: string
          queued_at: string
        }
        Insert: {
          attempts?: number
          item_id: string
          queued_at?: string
        }
        Update: {
          attempts?: number
          item_id?: string
          queued_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "declutter_wanted_queue_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "declutter_items"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_free_pauses: {
        Row: {
          created_at: string
          free_blocked_until: string
          order_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          free_blocked_until: string
          order_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          free_blocked_until?: string
          order_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      declutter_free_requests: {
        Row: {
          closed_at: string | null
          created_at: string
          id: string
          item_id: string
          requester_id: string
          seller_id: string
          status: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          id?: string
          item_id: string
          requester_id: string
          seller_id: string
          status?: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          id?: string
          item_id?: string
          requester_id?: string
          seller_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "declutter_free_requests_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "declutter_items"
            referencedColumns: ["id"]
          },
        ]
      }
      declutter_free_still_asks: {
        Row: {
          answered_at: string | null
          asked_at: string | null
          item_id: string
        }
        Insert: {
          answered_at?: string | null
          asked_at?: string | null
          item_id: string
        }
        Update: {
          answered_at?: string | null
          asked_at?: string | null
          item_id?: string
        }
        Relationships: []
      }
      declutter_watchlist: {
        Row: {
          created_at: string
          item_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          item_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          item_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "declutter_watchlist_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "declutter_items"
            referencedColumns: ["id"]
          },
        ]
      }
      deleted_jobs_log: {
        Row: {
          deleted_at: string
          is_seed: boolean
          job_created_at: string
          job_id: string
        }
        Insert: {
          deleted_at?: string
          is_seed: boolean
          job_created_at: string
          job_id: string
        }
        Update: {
          deleted_at?: string
          is_seed?: boolean
          job_created_at?: string
          job_id?: string
        }
        Relationships: []
      }
      dispute_settlement_claims: {
        Row: {
          action: string
          claimed_at: string
          claimed_by: string | null
          job_id: string
          money_step_at: string | null
          token: string
        }
        Insert: {
          action: string
          claimed_at?: string
          claimed_by?: string | null
          job_id: string
          money_step_at?: string | null
          token?: string
        }
        Update: {
          action?: string
          claimed_at?: string
          claimed_by?: string | null
          job_id?: string
          money_step_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispute_settlement_claims_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispute_settlement_claims_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispute_settlement_claims_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      disputes: {
        Row: {
          agreed_helper_id: string | null
          agreed_poster_id: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decided_via: string | null
          decision_text: string | null
          evidence_urls: string[]
          executed_at: string | null
          execution_error: string | null
          execution_helper_cents: number | null
          execution_refund_cents: number | null
          execution_refund_id: string | null
          execution_started_at: string | null
          execution_status: string | null
          execution_transfer_id: string | null
          helper_response: string | null
          id: string
          job_id: string
          opener_id: string | null
          payout_split: Json | null
          reason: string
          status: string
        }
        Insert: {
          agreed_helper_id?: string | null
          agreed_poster_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_via?: string | null
          decision_text?: string | null
          evidence_urls?: string[]
          executed_at?: string | null
          execution_error?: string | null
          execution_helper_cents?: number | null
          execution_refund_cents?: number | null
          execution_refund_id?: string | null
          execution_started_at?: string | null
          execution_status?: string | null
          execution_transfer_id?: string | null
          helper_response?: string | null
          id?: string
          job_id: string
          opener_id?: string | null
          payout_split?: Json | null
          reason: string
          status?: string
        }
        Update: {
          agreed_helper_id?: string | null
          agreed_poster_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_via?: string | null
          decision_text?: string | null
          evidence_urls?: string[]
          executed_at?: string | null
          execution_error?: string | null
          execution_helper_cents?: number | null
          execution_refund_cents?: number | null
          execution_refund_id?: string | null
          execution_started_at?: string | null
          execution_status?: string | null
          execution_transfer_id?: string | null
          helper_response?: string | null
          id?: string
          job_id?: string
          opener_id?: string | null
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
      edge_rate_limit_log: {
        Row: {
          bucket: string
          created_at: string
          forwarded_for: string | null
          id: number
          ip: string | null
          subject: string | null
        }
        Insert: {
          bucket: string
          created_at?: string
          forwarded_for?: string | null
          id?: number
          ip?: string | null
          subject?: string | null
        }
        Update: {
          bucket?: string
          created_at?: string
          forwarded_for?: string | null
          id?: number
          ip?: string | null
          subject?: string | null
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
      error_log_throttle_drops: {
        Row: {
          backend_pid: number
          drop_kind: string
          dropped: number
          first_at: string
          last_at: string
          minute: string
        }
        Insert: {
          backend_pid: number
          drop_kind: string
          dropped?: number
          first_at?: string
          last_at?: string
          minute: string
        }
        Update: {
          backend_pid?: number
          drop_kind?: string
          dropped?: number
          first_at?: string
          last_at?: string
          minute?: string
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
      facilitator_threshold_alerts: {
        Row: {
          crossed_at: string
          ops_alert_sent_at: string | null
          threshold_cents: number
          total_cents_at_alert: number
          year: number
        }
        Insert: {
          crossed_at?: string
          ops_alert_sent_at?: string | null
          threshold_cents: number
          total_cents_at_alert: number
          year: number
        }
        Update: {
          crossed_at?: string
          ops_alert_sent_at?: string | null
          threshold_cents?: number
          total_cents_at_alert?: number
          year?: number
        }
        Relationships: []
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
            foreignKeyName: "favorite_helpers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "favorite_helpers_helper_id_fkey"
            columns: ["helper_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
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
      feature_switch_members: {
        Row: {
          created_at: string
          key: string
          note: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          key: string
          note?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          key?: string
          note?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feature_switch_members_key_fkey"
            columns: ["key"]
            isOneToOne: false
            referencedRelation: "feature_switches"
            referencedColumns: ["key"]
          },
        ]
      }
      feature_switches: {
        Row: {
          audience: string
          created_at: string
          description: string
          key: string
          updated_at: string
        }
        Insert: {
          audience?: string
          created_at?: string
          description: string
          key: string
          updated_at?: string
        }
        Update: {
          audience?: string
          created_at?: string
          description?: string
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      gift_cards: {
        Row: {
          amount: number
          category: string | null
          claim_token: string | null
          created_at: string
          design_id: string | null
          donor_id: string | null
          expires_at: string | null
          id: string
          job_id: string | null
          message: string | null
          occasion: string | null
          parent_credit_id: string | null
          parish: string | null
          payment_status: string
          recipient_email: string | null
          recipient_id: string | null
          redeemed_at: string | null
          restored_from_job_id: string | null
          status: string
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
        }
        Insert: {
          amount: number
          category?: string | null
          claim_token?: string | null
          created_at?: string
          design_id?: string | null
          donor_id?: string | null
          expires_at?: string | null
          id?: string
          job_id?: string | null
          message?: string | null
          occasion?: string | null
          parent_credit_id?: string | null
          parish?: string | null
          payment_status?: string
          recipient_email?: string | null
          recipient_id?: string | null
          redeemed_at?: string | null
          restored_from_job_id?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
        }
        Update: {
          amount?: number
          category?: string | null
          claim_token?: string | null
          created_at?: string
          design_id?: string | null
          donor_id?: string | null
          expires_at?: string | null
          id?: string
          job_id?: string | null
          message?: string | null
          occasion?: string | null
          parent_credit_id?: string | null
          parish?: string | null
          payment_status?: string
          recipient_email?: string | null
          recipient_id?: string | null
          redeemed_at?: string | null
          restored_from_job_id?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gift_cards_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_cards_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_cards_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_cards_parent_credit_id_fkey"
            columns: ["parent_credit_id"]
            isOneToOne: false
            referencedRelation: "gift_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_cards_restored_from_job_id_fkey"
            columns: ["restored_from_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_cards_restored_from_job_id_fkey"
            columns: ["restored_from_job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_cards_restored_from_job_id_fkey"
            columns: ["restored_from_job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      group_job_helpers: {
        Row: {
          helper_arrival_near_miss_at: string | null
          helper_arrival_near_miss_ft: number | null
          helper_arrival_verified_at: string | null
          helper_arrived_at: string | null
          helper_completed_at: string | null
          helper_confirmed_at: string | null
          helper_dayof_confirmed_at: string | null
          helper_id: string | null
          helper_on_the_way_at: string | null
          id: string
          job_id: string
          joined_at: string | null
          poster_confirmed_arrival_at: string | null
          poster_confirmed_completion_at: string | null
          poster_confirmed_working_at: string | null
          proof_after_urls: string[] | null
          proof_before_urls: string[] | null
          response_deadline: string | null
          share_cents: number | null
          slot_no: number | null
          status: string
        }
        Insert: {
          helper_arrival_near_miss_at?: string | null
          helper_arrival_near_miss_ft?: number | null
          helper_arrival_verified_at?: string | null
          helper_arrived_at?: string | null
          helper_completed_at?: string | null
          helper_confirmed_at?: string | null
          helper_dayof_confirmed_at?: string | null
          helper_id?: string | null
          helper_on_the_way_at?: string | null
          id?: string
          job_id: string
          joined_at?: string | null
          poster_confirmed_arrival_at?: string | null
          poster_confirmed_completion_at?: string | null
          poster_confirmed_working_at?: string | null
          proof_after_urls?: string[] | null
          proof_before_urls?: string[] | null
          response_deadline?: string | null
          share_cents?: number | null
          slot_no?: number | null
          status?: string
        }
        Update: {
          helper_arrival_near_miss_at?: string | null
          helper_arrival_near_miss_ft?: number | null
          helper_arrival_verified_at?: string | null
          helper_arrived_at?: string | null
          helper_completed_at?: string | null
          helper_confirmed_at?: string | null
          helper_dayof_confirmed_at?: string | null
          helper_id?: string | null
          helper_on_the_way_at?: string | null
          id?: string
          job_id?: string
          joined_at?: string | null
          poster_confirmed_arrival_at?: string | null
          poster_confirmed_completion_at?: string | null
          poster_confirmed_working_at?: string | null
          proof_after_urls?: string[] | null
          proof_before_urls?: string[] | null
          response_deadline?: string | null
          share_cents?: number | null
          slot_no?: number | null
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
      helpr_delivery_online: {
        Row: {
          near_lat: number | null
          near_lng: number | null
          online_until: string | null
          radius_miles: number
          updated_at: string
          user_id: string
        }
        Insert: {
          near_lat?: number | null
          near_lng?: number | null
          online_until?: string | null
          radius_miles?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          near_lat?: number | null
          near_lng?: number | null
          online_until?: string | null
          radius_miles?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
        ]
      }
      helpr_start_reminder_sends: {
        Row: {
          job_id: string
          kind: string
          merged: boolean
          sent_at: string
          user_id: string
        }
        Insert: {
          job_id: string
          kind: string
          merged?: boolean
          sent_at?: string
          user_id: string
        }
        Update: {
          job_id?: string
          kind?: string
          merged?: boolean
          sent_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "helpr_start_reminder_sends_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "helpr_start_reminder_sends_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "helpr_start_reminder_sends_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      helpr_task_events: {
        Row: {
          actor_id: string | null
          created_at: string
          detail: string | null
          id: number
          task_event: string
          task_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          id?: number
          task_event: string
          task_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          id?: number
          task_event?: string
          task_id?: string
        }
        Relationships: [
        ]
      }
      helpr_task_payouts: {
        Row: {
          amount_cents: number
          attempts: number
          created_at: string
          debt_cents: number
          executed_at: string | null
          fee_cents: number
          held_notified_at: string | null
          helpr_id: string | null
          id: string
          is_seed: boolean
          last_error: string | null
          next_attempt_at: string
          pay_cents: number
          review_held_at: string | null
          review_reason: string | null
          settled_by_hand_cents: number | null
          settled_by_hand_note: string | null
          settled_by_hand_ref: string | null
          send_tried: boolean
          setup_fee_cents: number
          status: string
          stripe_transfer_id: string | null
          task_id: string
        }
        Insert: {
          amount_cents: number
          attempts?: number
          created_at?: string
          debt_cents?: number
          executed_at?: string | null
          fee_cents: number
          held_notified_at?: string | null
          helpr_id?: string | null
          id?: string
          is_seed?: boolean
          last_error?: string | null
          next_attempt_at?: string
          pay_cents: number
          review_held_at?: string | null
          review_reason?: string | null
          settled_by_hand_cents?: number | null
          settled_by_hand_note?: string | null
          settled_by_hand_ref?: string | null
          send_tried?: boolean
          setup_fee_cents?: number
          status: string
          stripe_transfer_id?: string | null
          task_id: string
        }
        Update: {
          amount_cents?: number
          attempts?: number
          created_at?: string
          debt_cents?: number
          executed_at?: string | null
          fee_cents?: number
          held_notified_at?: string | null
          helpr_id?: string | null
          id?: string
          is_seed?: boolean
          last_error?: string | null
          next_attempt_at?: string
          pay_cents?: number
          review_held_at?: string | null
          review_reason?: string | null
          settled_by_hand_cents?: number | null
          settled_by_hand_note?: string | null
          settled_by_hand_ref?: string | null
          send_tried?: boolean
          setup_fee_cents?: number
          status?: string
          stripe_transfer_id?: string | null
          task_id?: string
        }
        Relationships: [
        ]
      }
      helpr_task_tips: {
        Row: {
          attempt_id: string
          charged_cents: number | null
          created_at: string
          held: boolean
          helpr_id: string | null
          id: string
          is_seed: boolean
          paid_at: string | null
          paid_out_at: string | null
          payment_status: string
          payout_transfer_id: string | null
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          task_id: string
          tip_cents: number
          tipper_id: string | null
        }
        Insert: {
          attempt_id: string
          charged_cents?: number | null
          created_at?: string
          held?: boolean
          helpr_id?: string | null
          id?: string
          is_seed?: boolean
          paid_at?: string | null
          paid_out_at?: string | null
          payment_status?: string
          payout_transfer_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          task_id: string
          tip_cents: number
          tipper_id?: string | null
        }
        Update: {
          attempt_id?: string
          charged_cents?: number | null
          created_at?: string
          held?: boolean
          helpr_id?: string | null
          id?: string
          is_seed?: boolean
          paid_at?: string | null
          paid_out_at?: string | null
          payment_status?: string
          payout_transfer_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          task_id?: string
          tip_cents?: number
          tipper_id?: string | null
        }
        Relationships: [
        ]
      }
      helpr_tasks: {
        Row: {
          accepted_at: string | null
          close_note: string | null
          closed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          customer_id: string | null
          delivered_at: string | null
          dropoff_address: string
          dropoff_area: string
          dropoff_code: string
          dropoff_distance_m: number | null
          dropoff_lat: number
          dropoff_lng: number
          dropoff_photo_path: string | null
          fee_cents: number
          handed_over_at: string | null
          handed_over_to: string | null
          helpr_id: string | null
          id: string
          in_hand_nudged_at: string | null
          stuck_at: string | null
          stuck_reason: string | null
          stuck_note: string | null
          stuck_fault: string | null
          stuck_stage: string | null
          stuck_fix_by: string | null
          stuck_fix_note: string | null
          stuck_return_by: string | null
          stuck_choice: string | null
          stuck_choice_by: string | null
          stuck_collect_note: string | null
          returned_at: string | null
          return_photo_path: string | null
          return_answer_by: string | null
          return_distance_m: number | null
          is_seed: boolean
          latest_pickup_at: string
          open_until: string
          pay_cents: number
          picked_up_at: string | null
          pickup_address: string
          pickup_area: string
          pickup_contact_id: string | null
          pickup_lat: number
          pickup_lng: number
          pickup_photo_path: string | null
          pickup_slot_start: string | null
          raised_cents: number
          releases: number
          released_helpr_id: string | null
          seller_no_show_answer_by: string | null
          seller_no_show_answered_at: string | null
          seller_no_show_reported_at: string | null
          seller_no_show_settled_at: string | null
          size: string
          source_id: string
          source_kind: string
          status: string
          title: string
          trip_miles: number
          updated_at: string
          wrong_codes: number
        }
        Insert: {
          accepted_at?: string | null
          close_note?: string | null
          closed_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          customer_id?: string | null
          delivered_at?: string | null
          dropoff_address: string
          dropoff_area: string
          dropoff_code: string
          dropoff_distance_m?: number | null
          dropoff_lat: number
          dropoff_lng: number
          dropoff_photo_path?: string | null
          fee_cents: number
          handed_over_at?: string | null
          handed_over_to?: string | null
          helpr_id?: string | null
          id?: string
          in_hand_nudged_at?: string | null
          stuck_at?: string | null
          stuck_reason?: string | null
          stuck_note?: string | null
          stuck_fault?: string | null
          stuck_stage?: string | null
          stuck_fix_by?: string | null
          stuck_fix_note?: string | null
          stuck_return_by?: string | null
          stuck_choice?: string | null
          stuck_choice_by?: string | null
          stuck_collect_note?: string | null
          returned_at?: string | null
          return_photo_path?: string | null
          return_answer_by?: string | null
          return_distance_m?: number | null
          is_seed?: boolean
          latest_pickup_at: string
          open_until: string
          pay_cents: number
          picked_up_at?: string | null
          pickup_address: string
          pickup_area: string
          pickup_contact_id?: string | null
          pickup_lat: number
          pickup_lng: number
          pickup_photo_path?: string | null
          pickup_slot_start?: string | null
          raised_cents?: number
          releases?: number
          released_helpr_id?: string | null
          seller_no_show_answer_by?: string | null
          seller_no_show_answered_at?: string | null
          seller_no_show_reported_at?: string | null
          seller_no_show_settled_at?: string | null
          size: string
          source_id: string
          source_kind: string
          status?: string
          title: string
          trip_miles: number
          updated_at?: string
          wrong_codes?: number
        }
        Update: {
          accepted_at?: string | null
          close_note?: string | null
          closed_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          customer_id?: string | null
          delivered_at?: string | null
          dropoff_address?: string
          dropoff_area?: string
          dropoff_code?: string
          dropoff_distance_m?: number | null
          dropoff_lat?: number
          dropoff_lng?: number
          dropoff_photo_path?: string | null
          fee_cents?: number
          handed_over_at?: string | null
          handed_over_to?: string | null
          helpr_id?: string | null
          id?: string
          in_hand_nudged_at?: string | null
          stuck_at?: string | null
          stuck_reason?: string | null
          stuck_note?: string | null
          stuck_fault?: string | null
          stuck_stage?: string | null
          stuck_fix_by?: string | null
          stuck_fix_note?: string | null
          stuck_return_by?: string | null
          stuck_choice?: string | null
          stuck_choice_by?: string | null
          stuck_collect_note?: string | null
          returned_at?: string | null
          return_photo_path?: string | null
          return_answer_by?: string | null
          return_distance_m?: number | null
          is_seed?: boolean
          latest_pickup_at?: string
          open_until?: string
          pay_cents?: number
          picked_up_at?: string | null
          pickup_address?: string
          pickup_area?: string
          pickup_contact_id?: string | null
          pickup_lat?: number
          pickup_lng?: number
          pickup_photo_path?: string | null
          pickup_slot_start?: string | null
          raised_cents?: number
          releases?: number
          released_helpr_id?: string | null
          seller_no_show_answer_by?: string | null
          seller_no_show_answered_at?: string | null
          seller_no_show_reported_at?: string | null
          seller_no_show_settled_at?: string | null
          size?: string
          source_id?: string
          source_kind?: string
          status?: string
          title?: string
          trip_miles?: number
          updated_at?: string
          wrong_codes?: number
        }
        Relationships: [
        ]
      }
      helpr_vehicles: {
        Row: {
          has_car: boolean
          has_truck: boolean
          is_seed: boolean
          photo_path: string | null
          second_person: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          has_car?: boolean
          has_truck?: boolean
          is_seed?: boolean
          photo_path?: string | null
          second_person?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          has_car?: boolean
          has_truck?: boolean
          is_seed?: boolean
          photo_path?: string | null
          second_person?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
        ]
      }
      identity_soft_fingerprints: {
        Row: {
          nodoc_sha256: string
          updated_at: string
          user_id: string
        }
        Insert: {
          nodoc_sha256: string
          updated_at?: string
          user_id: string
        }
        Update: {
          nodoc_sha256?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      instant_payouts: {
        Row: {
          created_at: string
          error_message: string | null
          fee_amount: number
          fee_reversal_id: string | null
          fee_state: string
          fee_transfer_id: string | null
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
          fee_reversal_id?: string | null
          fee_state?: string
          fee_transfer_id?: string | null
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
          fee_reversal_id?: string | null
          fee_state?: string
          fee_transfer_id?: string | null
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
      job_accept_pending: {
        Row: {
          helper_id: string
          job_id: string
          requested_at: string
        }
        Insert: {
          helper_id: string
          job_id: string
          requested_at?: string
        }
        Update: {
          helper_id?: string
          job_id?: string
          requested_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_accept_pending_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_accept_pending_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_accept_pending_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      job_access_notes: {
        Row: {
          created_at: string
          job_id: string
          notes: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          job_id: string
          notes: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          job_id?: string
          notes?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_access_notes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_access_notes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_access_notes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      job_arrival_confirm_nudges: {
        Row: {
          created_at: string
          escalated_at: string | null
          first_sent_at: string | null
          job_id: string
          second_sent_at: string | null
        }
        Insert: {
          created_at?: string
          escalated_at?: string | null
          first_sent_at?: string | null
          job_id: string
          second_sent_at?: string | null
        }
        Update: {
          created_at?: string
          escalated_at?: string | null
          first_sent_at?: string | null
          job_id?: string
          second_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_arrival_confirm_nudges_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_arrival_confirm_nudges_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_arrival_confirm_nudges_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      job_cancel_id_waivers: {
        Row: {
          created_at: string
          job_id: string
        }
        Insert: {
          created_at?: string
          job_id: string
        }
        Update: {
          created_at?: string
          job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_cancel_id_waivers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_card_holds: {
        Row: {
          amount_cents: number
          attempts: number
          capture_amount_cents: number | null
          capture_before: string | null
          capturing_from: string | null
          created_at: string
          failure_code: string | null
          failure_message: string | null
          intent_metadata: Json
          job_id: string
          notified_state: string | null
          onboarding_fee_cents: number
          onboarding_fee_claimed_at: string | null
          payment_intent_id: string | null
          payment_method_id: string | null
          place_at: string | null
          state: string
          stripe_customer_id: string | null
          stripe_mode: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          attempts?: number
          capture_amount_cents?: number | null
          capture_before?: string | null
          capturing_from?: string | null
          created_at?: string
          failure_code?: string | null
          failure_message?: string | null
          intent_metadata?: Json
          job_id: string
          notified_state?: string | null
          onboarding_fee_cents?: number
          onboarding_fee_claimed_at?: string | null
          payment_intent_id?: string | null
          payment_method_id?: string | null
          place_at?: string | null
          state: string
          stripe_customer_id?: string | null
          stripe_mode: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          attempts?: number
          capture_amount_cents?: number | null
          capture_before?: string | null
          capturing_from?: string | null
          created_at?: string
          failure_code?: string | null
          failure_message?: string | null
          intent_metadata?: Json
          job_id?: string
          notified_state?: string | null
          onboarding_fee_cents?: number
          onboarding_fee_claimed_at?: string | null
          payment_intent_id?: string | null
          payment_method_id?: string | null
          place_at?: string | null
          state?: string
          stripe_customer_id?: string | null
          stripe_mode?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_card_holds_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_card_holds_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_card_holds_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
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
      job_approval_escalations: {
        Row: {
          created_at: string
          escalated_at: string
          job_id: string
          reason: string
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          created_at?: string
          escalated_at?: string
          job_id: string
          reason: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          created_at?: string
          escalated_at?: string
          job_id?: string
          reason?: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_approval_escalations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_approval_escalations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_approval_escalations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      job_completion_nudges: {
        Row: {
          created_at: string
          escalated_at: string | null
          first_sent_at: string | null
          job_id: string
          resolved_at: string | null
          resolved_by: string | null
          second_sent_at: string | null
        }
        Insert: {
          created_at?: string
          escalated_at?: string | null
          first_sent_at?: string | null
          job_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          second_sent_at?: string | null
        }
        Update: {
          created_at?: string
          escalated_at?: string | null
          first_sent_at?: string | null
          job_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          second_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_completion_nudges_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_completion_nudges_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_completion_nudges_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      job_detail_change_answers: {
        Row: {
          answer: string
          answered_at: string | null
          created_at: string
          helper_id: string
          request_id: string
        }
        Insert: {
          answer?: string
          answered_at?: string | null
          created_at?: string
          helper_id: string
          request_id: string
        }
        Update: {
          answer?: string
          answered_at?: string | null
          created_at?: string
          helper_id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_detail_change_answers_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "job_detail_change_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      job_detail_change_requests: {
        Row: {
          changed_fields: string[]
          created_at: string
          decided_at: string | null
          expires_at: string
          id: string
          job_id: string
          new_description: string | null
          new_latitude: number | null
          new_location: string | null
          new_longitude: number | null
          new_materials_note: string | null
          new_title: string | null
          old_description: string | null
          old_location: string | null
          old_materials_note: string | null
          old_title: string | null
          requested_by: string
          status: string
        }
        Insert: {
          changed_fields: string[]
          created_at?: string
          decided_at?: string | null
          expires_at: string
          id?: string
          job_id: string
          new_description?: string | null
          new_latitude?: number | null
          new_location?: string | null
          new_longitude?: number | null
          new_materials_note?: string | null
          new_title?: string | null
          old_description?: string | null
          old_location?: string | null
          old_materials_note?: string | null
          old_title?: string | null
          requested_by: string
          status?: string
        }
        Update: {
          changed_fields?: string[]
          created_at?: string
          decided_at?: string | null
          expires_at?: string
          id?: string
          job_id?: string
          new_description?: string | null
          new_latitude?: number | null
          new_location?: string | null
          new_longitude?: number | null
          new_materials_note?: string | null
          new_title?: string | null
          old_description?: string | null
          old_location?: string | null
          old_materials_note?: string | null
          old_title?: string | null
          requested_by?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_detail_change_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_detail_change_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_detail_change_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      job_guarantee_claims: {
        Row: {
          closed_at: string | null
          close_reason: string | null
          created_at: string
          dispute_id: string | null
          fix_date: string | null
          fixed_at: string | null
          helper_id: string | null
          helpr_answer_by: string
          helpr_answered_at: string | null
          id: string
          job_id: string
          note: string
          photo_paths: string[]
          poster_answer_by: string | null
          poster_id: string | null
          poster_reject_note: string | null
          status: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          close_reason?: string | null
          created_at?: string
          dispute_id?: string | null
          fix_date?: string | null
          fixed_at?: string | null
          helper_id?: string | null
          helpr_answer_by: string
          helpr_answered_at?: string | null
          id?: string
          job_id: string
          note: string
          photo_paths?: string[]
          poster_answer_by?: string | null
          poster_id?: string | null
          poster_reject_note?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          close_reason?: string | null
          created_at?: string
          dispute_id?: string | null
          fix_date?: string | null
          fixed_at?: string | null
          helper_id?: string | null
          helpr_answer_by?: string
          helpr_answered_at?: string | null
          id?: string
          job_id?: string
          note?: string
          photo_paths?: string[]
          poster_answer_by?: string | null
          poster_id?: string | null
          poster_reject_note?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      job_helpr_fault_fee_deductions: {
        Row: {
          created_at: string
          deducted_cents: number
          id: string
          payout_ref: string
          ruling_id: string
        }
        Insert: {
          created_at?: string
          deducted_cents: number
          id?: string
          payout_ref: string
          ruling_id: string
        }
        Update: {
          created_at?: string
          deducted_cents?: number
          id?: string
          payout_ref?: string
          ruling_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_helpr_fault_fee_deductions_ruling_id_fkey"
            columns: ["ruling_id"]
            isOneToOne: false
            referencedRelation: "job_helpr_fault_rulings"
            referencedColumns: ["id"]
          },
        ]
      }
      job_helpr_fault_rulings: {
        Row: {
          admin_id: string | null
          card_fee_cents: number | null
          card_fee_remaining_cents: number | null
          created_at: string
          helper_id: string | null
          id: string
          is_seed: boolean
          job_id: string
          kind: string
          note: string
          refund_ref: string | null
        }
        Insert: {
          admin_id?: string | null
          card_fee_cents?: number | null
          card_fee_remaining_cents?: number | null
          created_at?: string
          helper_id?: string | null
          id?: string
          is_seed?: boolean
          job_id: string
          kind: string
          note: string
          refund_ref?: string | null
        }
        Update: {
          admin_id?: string | null
          card_fee_cents?: number | null
          card_fee_remaining_cents?: number | null
          created_at?: string
          helper_id?: string | null
          id?: string
          is_seed?: boolean
          job_id?: string
          kind?: string
          note?: string
          refund_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_helpr_fault_rulings_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_helpr_fault_rulings_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_helpr_fault_rulings_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      job_checkout_nudges: {
        Row: {
          created_at: string
          email_note: string | null
          emailed: boolean | null
          job_id: string
          notification_id: string | null
          stripe_session_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          email_note?: string | null
          emailed?: boolean | null
          job_id: string
          notification_id?: string | null
          stripe_session_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          email_note?: string | null
          emailed?: boolean | null
          job_id?: string
          notification_id?: string | null
          stripe_session_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_checkout_nudges_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_checkout_nudges_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_checkout_nudges_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      job_match_email_state: {
        Row: {
          last_emailed_day: string | null
          updated_at: string
          user_id: string
          waiting: number
        }
        Insert: {
          last_emailed_day?: string | null
          updated_at?: string
          user_id: string
          waiting?: number
        }
        Update: {
          last_emailed_day?: string | null
          updated_at?: string
          user_id?: string
          waiting?: number
        }
        Relationships: []
      }
      job_match_queue: {
        Row: {
          attempts: number
          created_at: string
          drop_reason: string | null
          id: string
          job_id: string
          link: string
          message: string
          notify_at: string
          retry_after: string | null
          send_email: boolean
          settled_at: string | null
          source: string
          status: string
          title: string
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          drop_reason?: string | null
          id?: string
          job_id: string
          link: string
          message: string
          notify_at: string
          retry_after?: string | null
          send_email?: boolean
          settled_at?: string | null
          source: string
          status?: string
          title: string
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          drop_reason?: string | null
          id?: string
          job_id?: string
          link?: string
          message?: string
          notify_at?: string
          retry_after?: string | null
          send_email?: boolean
          settled_at?: string | null
          source?: string
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_match_queue_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_match_queue_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_match_queue_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      job_payout_holds: {
        Row: {
          held_at: string
          held_by: string | null
          job_id: string
          reason: string
        }
        Insert: {
          held_at?: string
          held_by?: string | null
          job_id: string
          reason: string
        }
        Update: {
          held_at?: string
          held_by?: string | null
          job_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_payout_holds_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_payout_holds_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_payout_holds_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      job_pets: {
        Row: {
          created_at: string
          job_id: string
          pet_id: string
        }
        Insert: {
          created_at?: string
          job_id: string
          pet_id: string
        }
        Update: {
          created_at?: string
          job_id?: string
          pet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_pets_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_pets_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_pets_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_pets_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pet_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_post_drafts: {
        Row: {
          draft: Json
          reminded_at: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          draft: Json
          reminded_at?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          draft?: Json
          reminded_at?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      job_quote_offers: {
        Row: {
          by_side: string
          created_at: string
          id: string
          note: string | null
          price_cents: number
          quote_id: string
        }
        Insert: {
          by_side: string
          created_at?: string
          id?: string
          note?: string | null
          price_cents: number
          quote_id: string
        }
        Update: {
          by_side?: string
          created_at?: string
          id?: string
          note?: string | null
          price_cents?: number
          quote_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_quote_offers_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "job_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      job_quote_requests: {
        Row: {
          category: Database["public"]["Enums"]["job_category"]
          close_notice_sent_at: string | null
          created_at: string
          date_needed: string
          description: string
          estimated_hours: number | null
          id: string
          invited_only: boolean
          is_seed: boolean
          job_id: string | null
          latitude: number | null
          location: string | null
          longitude: number | null
          parish: string | null
          poster_id: string | null
          quotes_close_at: string
          start_time: string | null
          status: string
          title: string
          updated_at: string
          window_hours: number
        }
        Insert: {
          category?: Database["public"]["Enums"]["job_category"]
          close_notice_sent_at?: string | null
          created_at?: string
          date_needed: string
          description: string
          estimated_hours?: number | null
          id?: string
          invited_only?: boolean
          is_seed?: boolean
          job_id?: string | null
          latitude?: number | null
          location?: string | null
          longitude?: number | null
          parish?: string | null
          poster_id?: string | null
          quotes_close_at: string
          start_time?: string | null
          status?: string
          title: string
          updated_at?: string
          window_hours?: number
        }
        Update: {
          category?: Database["public"]["Enums"]["job_category"]
          close_notice_sent_at?: string | null
          created_at?: string
          date_needed?: string
          description?: string
          estimated_hours?: number | null
          id?: string
          invited_only?: boolean
          is_seed?: boolean
          job_id?: string | null
          latitude?: number | null
          location?: string | null
          longitude?: number | null
          parish?: string | null
          poster_id?: string | null
          quotes_close_at?: string
          start_time?: string | null
          status?: string
          title?: string
          updated_at?: string
          window_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_quote_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_quote_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_quote_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      job_quotes: {
        Row: {
          available_note: string
          created_at: string
          id: string
          last_offer_side: string
          note: string
          offer_count: number
          photo_paths: string[]
          price_cents: number
          quoter_id: string | null
          request_id: string
          reminder_sent_for: string | null
          respond_until: string
          status: string
          updated_at: string
        }
        Insert: {
          available_note: string
          created_at?: string
          id?: string
          last_offer_side?: string
          note: string
          offer_count?: number
          photo_paths?: string[]
          price_cents: number
          quoter_id?: string | null
          request_id: string
          reminder_sent_for?: string | null
          respond_until: string
          status?: string
          updated_at?: string
        }
        Update: {
          available_note?: string
          created_at?: string
          id?: string
          last_offer_side?: string
          note?: string
          offer_count?: number
          photo_paths?: string[]
          price_cents?: number
          quoter_id?: string | null
          request_id?: string
          reminder_sent_for?: string | null
          respond_until?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_quotes_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "job_quote_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      job_refund_claims: {
        Row: {
          actor_user_id: string | null
          claimed_at: string
          claimed_by: string
          job_id: string
        }
        Insert: {
          actor_user_id?: string | null
          claimed_at?: string
          claimed_by: string
          job_id: string
        }
        Update: {
          actor_user_id?: string | null
          claimed_at?: string
          claimed_by?: string
          job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_refund_claims_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_refund_claims_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_refund_claims_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      job_reminder_types: {
        Row: {
          always_on: boolean
          description: string
          kind: string
          label: string
          match_message_like: string | null
          match_title: string
          match_type: string
          pref_column: string | null
          sort_order: number
        }
        Insert: {
          always_on: boolean
          description: string
          kind: string
          label: string
          match_message_like?: string | null
          match_title: string
          match_type: string
          pref_column?: string | null
          sort_order?: number
        }
        Update: {
          always_on?: boolean
          description?: string
          kind?: string
          label?: string
          match_message_like?: string | null
          match_title?: string
          match_type?: string
          pref_column?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      job_revisions: {
        Row: {
          created_at: string
          description: string
          helper_response: string | null
          id: string
          job_id: string
          photos: string[] | null
          requested_by: string | null
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
          requested_by?: string | null
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
          requested_by?: string | null
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
      job_schedule_change_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          expires_at: string
          id: string
          job_id: string
          new_date: string
          new_start_time: string | null
          old_date: string
          old_start_time: string | null
          requested_by: string
          responder_id: string
          status: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          expires_at: string
          id?: string
          job_id: string
          new_date: string
          new_start_time?: string | null
          old_date: string
          old_start_time?: string | null
          requested_by: string
          responder_id: string
          status?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          expires_at?: string
          id?: string
          job_id?: string
          new_date?: string
          new_start_time?: string | null
          old_date?: string
          old_start_time?: string | null
          requested_by?: string
          responder_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_schedule_change_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_schedule_change_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_schedule_change_requests_job_id_fkey"
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
          accepted_at: string | null
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
          chargeback_evidence_due_by: string | null
          client_request_id: string | null
          commission_tax_amount: number | null
          completed_at: string | null
          created_at: string
          credential_tier: number
          customer_fee_amount: number | null
          customer_id: string | null
          date_needed: string
          dayof_confirm_reminder_sent_at: string | null
          dayof_unanswered_poster_alert_sent_at: string | null
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
          expiring_final_notif_sent: boolean | null
          expiring_notif_sent: boolean | null
          flag_reasons: string[] | null
          has_active_dispute: boolean
          helper_arrival_near_miss_at: string | null
          helper_arrival_near_miss_ft: number | null
          helper_arrival_verified_at: string | null
          helper_arrived_at: string | null
          helper_completed_at: string | null
          helper_confirmed_at: string | null
          helper_dayof_confirmed_at: string | null
          helper_fee_flat_cents: number | null
          helper_fee_percent: number | null
          helper_id: string | null
          helper_on_the_way_at: string | null
          helpers_needed: number | null
          id: string
          is_auto_created: boolean
          is_flexible_schedule: boolean
          is_group_job: boolean | null
          is_recurring: boolean | null
          is_seed: boolean
          is_urgent: boolean | null
          late_cancellation: boolean | null
          last_edit_notice_at: string | null
          latitude: number | null
          location: string | null
          longitude: number | null
          materials_note: string | null
          no_show_alert_sent_at: string | null
          offered_to_helper_id: string | null
          onboarding_fee_amount: number | null
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
          poster_fee_flat_cents: number | null
          poster_marked_done_at: string | null
          pricing_mode: string
          proof_after_urls: string[] | null
          proof_before_urls: string[] | null
          protection_fee: number | null
          recurrence_days: number[] | null
          recurrence_end_date: string | null
          recurrence_interval: string | null
          recurrence_weeks: number | null
          recurring_helper_id: string | null
          release_last_chance_notif_sent_at: string | null
          removal_reason: string | null
          removed_at: string | null
          removed_by: string | null
          require_photo_proof: boolean
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
          scope_video_url: string | null
          series_ban_cancelled_at: string | null
          series_ended_on: string | null
          series_split_ok: boolean
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
          accepted_at?: string | null
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
          chargeback_evidence_due_by?: string | null
          client_request_id?: string | null
          commission_tax_amount?: number | null
          completed_at?: string | null
          created_at?: string
          credential_tier?: number
          customer_fee_amount?: number | null
          customer_id?: string | null
          date_needed: string
          dayof_confirm_reminder_sent_at?: string | null
          dayof_unanswered_poster_alert_sent_at?: string | null
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
          expiring_final_notif_sent?: boolean | null
          expiring_notif_sent?: boolean | null
          flag_reasons?: string[] | null
          has_active_dispute?: boolean
          helper_arrival_near_miss_at?: string | null
          helper_arrival_near_miss_ft?: number | null
          helper_arrival_verified_at?: string | null
          helper_arrived_at?: string | null
          helper_completed_at?: string | null
          helper_confirmed_at?: string | null
          helper_dayof_confirmed_at?: string | null
          helper_fee_flat_cents?: number | null
          helper_fee_percent?: number | null
          helper_id?: string | null
          helper_on_the_way_at?: string | null
          helpers_needed?: number | null
          id?: string
          is_auto_created?: boolean
          is_flexible_schedule?: boolean
          is_group_job?: boolean | null
          is_recurring?: boolean | null
          is_seed?: boolean
          is_urgent?: boolean | null
          late_cancellation?: boolean | null
          last_edit_notice_at?: string | null
          latitude?: number | null
          location?: string | null
          longitude?: number | null
          materials_note?: string | null
          no_show_alert_sent_at?: string | null
          offered_to_helper_id?: string | null
          onboarding_fee_amount?: number | null
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
          poster_fee_flat_cents?: number | null
          poster_marked_done_at?: string | null
          pricing_mode?: string
          proof_after_urls?: string[] | null
          proof_before_urls?: string[] | null
          protection_fee?: number | null
          recurrence_days?: number[] | null
          recurrence_end_date?: string | null
          recurrence_interval?: string | null
          recurrence_weeks?: number | null
          recurring_helper_id?: string | null
          release_last_chance_notif_sent_at?: string | null
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          require_photo_proof?: boolean
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
          scope_video_url?: string | null
          series_ban_cancelled_at?: string | null
          series_ended_on?: string | null
          series_split_ok?: boolean
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
          accepted_at?: string | null
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
          chargeback_evidence_due_by?: string | null
          client_request_id?: string | null
          commission_tax_amount?: number | null
          completed_at?: string | null
          created_at?: string
          credential_tier?: number
          customer_fee_amount?: number | null
          customer_id?: string | null
          date_needed?: string
          dayof_confirm_reminder_sent_at?: string | null
          dayof_unanswered_poster_alert_sent_at?: string | null
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
          expiring_final_notif_sent?: boolean | null
          expiring_notif_sent?: boolean | null
          flag_reasons?: string[] | null
          has_active_dispute?: boolean
          helper_arrival_near_miss_at?: string | null
          helper_arrival_near_miss_ft?: number | null
          helper_arrival_verified_at?: string | null
          helper_arrived_at?: string | null
          helper_completed_at?: string | null
          helper_confirmed_at?: string | null
          helper_dayof_confirmed_at?: string | null
          helper_fee_flat_cents?: number | null
          helper_fee_percent?: number | null
          helper_id?: string | null
          helper_on_the_way_at?: string | null
          helpers_needed?: number | null
          id?: string
          is_auto_created?: boolean
          is_flexible_schedule?: boolean
          is_group_job?: boolean | null
          is_recurring?: boolean | null
          is_seed?: boolean
          is_urgent?: boolean | null
          late_cancellation?: boolean | null
          last_edit_notice_at?: string | null
          latitude?: number | null
          location?: string | null
          longitude?: number | null
          materials_note?: string | null
          no_show_alert_sent_at?: string | null
          offered_to_helper_id?: string | null
          onboarding_fee_amount?: number | null
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
          poster_fee_flat_cents?: number | null
          poster_marked_done_at?: string | null
          pricing_mode?: string
          proof_after_urls?: string[] | null
          proof_before_urls?: string[] | null
          protection_fee?: number | null
          recurrence_days?: number[] | null
          recurrence_end_date?: string | null
          recurrence_interval?: string | null
          recurrence_weeks?: number | null
          recurring_helper_id?: string | null
          release_last_chance_notif_sent_at?: string | null
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          require_photo_proof?: boolean
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
          scope_video_url?: string | null
          series_ban_cancelled_at?: string | null
          series_ended_on?: string | null
          series_split_ok?: boolean
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
      landlord_id_reviews: {
        Row: {
          back_path: string | null
          created_at: string
          front_path: string | null
          images_deleted_at: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          back_path?: string | null
          created_at?: string
          front_path?: string | null
          images_deleted_at?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          back_path?: string | null
          created_at?: string
          front_path?: string | null
          images_deleted_at?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ip_address?: string | null
          marketing_opted_in?: boolean
          privacy_version: string
          terms_version: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ip_address?: string | null
          marketing_opted_in?: boolean
          privacy_version?: string
          terms_version?: string
          user_agent?: string | null
          user_id?: string | null
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
          latitude: number | null
          longitude: number | null
          parish: string
          zip_code: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          latitude?: number | null
          longitude?: number | null
          parish: string
          zip_code: string
        }
        Update: {
          city?: string | null
          created_at?: string
          latitude?: number | null
          longitude?: number | null
          parish?: string
          zip_code?: string
        }
        Relationships: []
      }
      maintenance_request_photos: {
        Row: {
          created_at: string
          id: string
          position: number
          request_id: string
          storage_path: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          position: number
          request_id: string
          storage_path: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          position?: number
          request_id?: string
          storage_path?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_request_photos_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "maintenance_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_requests: {
        Row: {
          access_notes: string
          access_windows: string
          approved_budget_cents: number | null
          auto_approved: boolean
          category: string
          created_at: string
          decided_at: string | null
          decline_reason_code: string | null
          decline_reason_text: string | null
          description: string
          id: string
          job_id: string | null
          landlord_id: string | null
          ok_to_enter_alone: boolean
          pets_on_site: boolean
          property_address: string
          property_id: string | null
          property_label: string
          status: string
          tenancy_id: string | null
          tenant_answered_at: string | null
          tenant_fixed_note: string | null
          tenant_id: string | null
          tenant_says_fixed: boolean | null
          unit_id: string | null
          unit_label: string
          updated_at: string
          urgency: string
          visit_confirmed_at: string | null
          visit_job_id: string | null
          visit_proposed_at: string | null
          visit_proposed_for: string | null
        }
        Insert: {
          access_notes?: string
          access_windows?: string
          approved_budget_cents?: number | null
          auto_approved?: boolean
          category: string
          created_at?: string
          decided_at?: string | null
          decline_reason_code?: string | null
          decline_reason_text?: string | null
          description: string
          id?: string
          job_id?: string | null
          landlord_id?: string | null
          ok_to_enter_alone?: boolean
          pets_on_site?: boolean
          property_address: string
          property_id?: string | null
          property_label: string
          status?: string
          tenancy_id?: string | null
          tenant_answered_at?: string | null
          tenant_fixed_note?: string | null
          tenant_id?: string | null
          tenant_says_fixed?: boolean | null
          unit_id?: string | null
          unit_label: string
          updated_at?: string
          urgency: string
          visit_confirmed_at?: string | null
          visit_job_id?: string | null
          visit_proposed_at?: string | null
          visit_proposed_for?: string | null
        }
        Update: {
          access_notes?: string
          access_windows?: string
          approved_budget_cents?: number | null
          auto_approved?: boolean
          category?: string
          created_at?: string
          decided_at?: string | null
          decline_reason_code?: string | null
          decline_reason_text?: string | null
          description?: string
          id?: string
          job_id?: string | null
          landlord_id?: string | null
          ok_to_enter_alone?: boolean
          pets_on_site?: boolean
          property_address?: string
          property_id?: string | null
          property_label?: string
          status?: string
          tenancy_id?: string | null
          tenant_answered_at?: string | null
          tenant_fixed_note?: string | null
          tenant_id?: string | null
          tenant_says_fixed?: boolean | null
          unit_id?: string | null
          unit_label?: string
          updated_at?: string
          urgency?: string
          visit_confirmed_at?: string | null
          visit_job_id?: string | null
          visit_proposed_at?: string | null
          visit_proposed_for?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_requests_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "rental_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_requests_tenancy_id_fkey"
            columns: ["tenancy_id"]
            isOneToOne: false
            referencedRelation: "rental_tenancies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_requests_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "rental_units"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_content: {
        Row: {
          attempts: number
          body: string
          campaign: string | null
          channel: Database["public"]["Enums"]["marketing_channel"]
          created_at: string
          created_by: string | null
          external_id: string | null
          external_url: string | null
          generated_by: string | null
          hashtags: string[]
          id: string
          last_error: string | null
          locked_at: string | null
          media_urls: string[]
          model: string | null
          parish: string | null
          published_at: string | null
          scheduled_for: string | null
          status: Database["public"]["Enums"]["marketing_status"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          body: string
          campaign?: string | null
          channel: Database["public"]["Enums"]["marketing_channel"]
          created_at?: string
          created_by?: string | null
          external_id?: string | null
          external_url?: string | null
          generated_by?: string | null
          hashtags?: string[]
          id?: string
          last_error?: string | null
          locked_at?: string | null
          media_urls?: string[]
          model?: string | null
          parish?: string | null
          published_at?: string | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["marketing_status"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          body?: string
          campaign?: string | null
          channel?: Database["public"]["Enums"]["marketing_channel"]
          created_at?: string
          created_by?: string | null
          external_id?: string | null
          external_url?: string | null
          generated_by?: string | null
          hashtags?: string[]
          id?: string
          last_error?: string | null
          locked_at?: string | null
          media_urls?: string[]
          model?: string | null
          parish?: string | null
          published_at?: string | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["marketing_status"]
          updated_at?: string
        }
        Relationships: []
      }
      marketing_settings: {
        Row: {
          auto_publish_enabled: boolean
          channels_enabled: Json
          daily_post_cap: number
          id: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          auto_publish_enabled?: boolean
          channels_enabled?: Json
          daily_post_cap?: number
          id?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          auto_publish_enabled?: boolean
          channels_enabled?: Json
          daily_post_cap?: number
          id?: boolean
          updated_at?: string
          updated_by?: string | null
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
      member_signup_sources: {
        Row: {
          campaign: string | null
          recorded_at: string
          source: string
          user_id: string
        }
        Insert: {
          campaign?: string | null
          recorded_at?: string
          source: string
          user_id: string
        }
        Update: {
          campaign?: string | null
          recorded_at?: string
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      message_reactions: {
        Row: {
          created_at: string
          emoji: string
          job_id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          job_id: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          job_id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
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
          client_id: string | null
          content: string
          created_at: string
          edited_at: string | null
          flag_reason: string | null
          flagged_hidden: boolean
          id: string
          is_system: boolean
          job_id: string | null
          read: boolean
          read_at: string | null
          receiver_id: string | null
          reply_to_id: string | null
          sender_id: string
          team_thread_user_id: string | null
        }
        Insert: {
          attachment_duration?: number | null
          attachment_mime?: string | null
          attachment_size?: number | null
          attachment_url?: string | null
          client_id?: string | null
          content: string
          created_at?: string
          edited_at?: string | null
          flag_reason?: string | null
          flagged_hidden?: boolean
          id?: string
          is_system?: boolean
          job_id?: string | null
          read?: boolean
          read_at?: string | null
          receiver_id?: string | null
          reply_to_id?: string | null
          sender_id: string
          team_thread_user_id?: string | null
        }
        Update: {
          attachment_duration?: number | null
          attachment_mime?: string | null
          attachment_size?: number | null
          attachment_url?: string | null
          client_id?: string | null
          content?: string
          created_at?: string
          edited_at?: string | null
          flag_reason?: string | null
          flagged_hidden?: boolean
          id?: string
          is_system?: boolean
          job_id?: string | null
          read?: boolean
          read_at?: string | null
          receiver_id?: string | null
          reply_to_id?: string | null
          sender_id?: string
          team_thread_user_id?: string | null
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
            foreignKeyName: "messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      migration_deploy_ledger: {
        Row: {
          head_sha: string
          recorded_at: string
          run_attempt: number
          run_id: number
          version: string
        }
        Insert: {
          head_sha: string
          recorded_at?: string
          run_attempt?: number
          run_id: number
          version: string
        }
        Update: {
          head_sha?: string
          recorded_at?: string
          run_attempt?: number
          run_id?: number
          version?: string
        }
        Relationships: []
      }
      new_member_admin_notices: {
        Row: {
          notified_at: string
          summarized_at: string | null
          user_id: string
          via: string
        }
        Insert: {
          notified_at?: string
          summarized_at?: string | null
          user_id: string
          via: string
        }
        Update: {
          notified_at?: string
          summarized_at?: string | null
          user_id?: string
          via?: string
        }
        Relationships: []
      }
      notification_dedupe_suppressions: {
        Row: {
          id: number
          link: string | null
          suppressed_at: string
          title: string | null
          type: string | null
          user_id: string
        }
        Insert: {
          id?: number
          link?: string | null
          suppressed_at?: string
          title?: string | null
          type?: string | null
          user_id: string
        }
        Update: {
          id?: number
          link?: string | null
          suppressed_at?: string
          title?: string | null
          type?: string | null
          user_id?: string
        }
        Relationships: []
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
          declutter_listings: boolean
          declutter_offers: boolean
          declutter_pickups: boolean
          declutter_price_drops: boolean
          declutter_refunds: boolean
          declutter_sales: boolean
          declutter_wanted: boolean
          declutter_questions: boolean
          email_declutter_listings: boolean
          email_declutter_offers: boolean
          email_declutter_pickups: boolean
          email_declutter_price_drops: boolean
          email_declutter_refunds: boolean
          email_declutter_sales: boolean
          email_declutter_wanted: boolean
          email_declutter_questions: boolean
          email_enabled: boolean
          email_financial_alerts: boolean
          email_job_applications: boolean
          email_job_matches: boolean
          email_job_updates: boolean
          email_messages: boolean
          email_new_offers: boolean
          email_payments: boolean
          email_promotions: boolean | null
          email_quote_reminders: boolean
          email_reviews: boolean
          email_system_alerts: boolean
          email_transit_updates: boolean
          email_work_status: boolean
          financial_alerts: boolean
          id: string
          job_applications: boolean
          job_matches: boolean
          job_updates: boolean
          match_digest_mode: boolean
          message_preview: boolean
          messages: boolean
          new_offers: boolean
          payments: boolean
          promotions: boolean
          push_enabled: boolean
          quiet_end: string | null
          quiet_start: string | null
          remind_finish_job: boolean
          remind_head_out: boolean
          remind_morning_of: boolean
          remind_payout_followups: boolean
          remind_starting_soon: boolean
          remind_two_hours: boolean
          reviews: boolean
          saved_helper_availability: boolean
          saved_searches_paused: boolean
          system_alerts: boolean
          sms_phone_prompt_dismissed_at: string | null
          transit_updates: boolean
          updated_at: string
          user_id: string
          work_status: boolean
        }
        Insert: {
          created_at?: string
          declutter_listings?: boolean
          declutter_offers?: boolean
          declutter_pickups?: boolean
          declutter_price_drops?: boolean
          declutter_refunds?: boolean
          declutter_sales?: boolean
          declutter_wanted?: boolean
          declutter_questions?: boolean
          email_declutter_listings?: boolean
          email_declutter_offers?: boolean
          email_declutter_pickups?: boolean
          email_declutter_price_drops?: boolean
          email_declutter_refunds?: boolean
          email_declutter_sales?: boolean
          email_declutter_wanted?: boolean
          email_declutter_questions?: boolean
          email_enabled?: boolean
          email_financial_alerts?: boolean
          email_job_applications?: boolean
          email_job_matches?: boolean
          email_job_updates?: boolean
          email_messages?: boolean
          email_new_offers?: boolean
          email_payments?: boolean
          email_promotions?: boolean | null
          email_quote_reminders?: boolean
          email_reviews?: boolean
          email_system_alerts?: boolean
          email_transit_updates?: boolean
          email_work_status?: boolean
          financial_alerts?: boolean
          id?: string
          job_applications?: boolean
          job_matches?: boolean
          job_updates?: boolean
          match_digest_mode?: boolean
          message_preview?: boolean
          messages?: boolean
          new_offers?: boolean
          payments?: boolean
          promotions?: boolean
          push_enabled?: boolean
          quiet_end?: string | null
          quiet_start?: string | null
          remind_finish_job?: boolean
          remind_head_out?: boolean
          remind_morning_of?: boolean
          remind_payout_followups?: boolean
          remind_starting_soon?: boolean
          remind_two_hours?: boolean
          reviews?: boolean
          saved_helper_availability?: boolean
          saved_searches_paused?: boolean
          system_alerts?: boolean
          sms_phone_prompt_dismissed_at?: string | null
          transit_updates?: boolean
          updated_at?: string
          user_id: string
          work_status?: boolean
        }
        Update: {
          created_at?: string
          declutter_listings?: boolean
          declutter_offers?: boolean
          declutter_pickups?: boolean
          declutter_price_drops?: boolean
          declutter_refunds?: boolean
          declutter_sales?: boolean
          declutter_wanted?: boolean
          declutter_questions?: boolean
          email_declutter_listings?: boolean
          email_declutter_offers?: boolean
          email_declutter_pickups?: boolean
          email_declutter_price_drops?: boolean
          email_declutter_refunds?: boolean
          email_declutter_sales?: boolean
          email_declutter_wanted?: boolean
          email_declutter_questions?: boolean
          email_enabled?: boolean
          email_financial_alerts?: boolean
          email_job_applications?: boolean
          email_job_matches?: boolean
          email_job_updates?: boolean
          email_messages?: boolean
          email_new_offers?: boolean
          email_payments?: boolean
          email_promotions?: boolean | null
          email_quote_reminders?: boolean
          email_reviews?: boolean
          email_system_alerts?: boolean
          email_transit_updates?: boolean
          email_work_status?: boolean
          financial_alerts?: boolean
          id?: string
          job_applications?: boolean
          job_matches?: boolean
          job_updates?: boolean
          match_digest_mode?: boolean
          message_preview?: boolean
          messages?: boolean
          new_offers?: boolean
          payments?: boolean
          promotions?: boolean
          push_enabled?: boolean
          quiet_end?: string | null
          quiet_start?: string | null
          remind_finish_job?: boolean
          remind_head_out?: boolean
          remind_morning_of?: boolean
          remind_payout_followups?: boolean
          remind_starting_soon?: boolean
          remind_two_hours?: boolean
          reviews?: boolean
          saved_helper_availability?: boolean
          saved_searches_paused?: boolean
          system_alerts?: boolean
          sms_phone_prompt_dismissed_at?: string | null
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
          job_id: string | null
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
          job_id?: string | null
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
          job_id?: string | null
          link?: string | null
          message?: string
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
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
      ops_alert_admin_subjects: {
        Row: {
          alerted_at: string
          job_id: string | null
          rule: string
          subject_key: string
          user_id: string | null
        }
        Insert: {
          alerted_at: string
          job_id?: string | null
          rule: string
          subject_key: string
          user_id?: string | null
        }
        Update: {
          alerted_at?: string
          job_id?: string | null
          rule?: string
          subject_key?: string
          user_id?: string | null
        }
        Relationships: []
      }
      ops_alert_ledger: {
        Row: {
          closed_at: string | null
          closed_evidence: string | null
          count: number
          fingerprint: string
          first_seen: string
          id: string
          last_seen: string
          reopen_count: number
          sample: string | null
          sample_ref: Json
          severity: string
          source: string
          source_kind: string
          status: string
          title: string
          updated_at: string
          verify_kind: string
          verify_note: string | null
          verify_ref: string | null
          verify_started_at: string | null
        }
        Insert: {
          closed_at?: string | null
          closed_evidence?: string | null
          count?: number
          fingerprint: string
          first_seen?: string
          id?: string
          last_seen?: string
          reopen_count?: number
          sample?: string | null
          sample_ref?: Json
          severity: string
          source: string
          source_kind: string
          status?: string
          title: string
          updated_at?: string
          verify_kind?: string
          verify_note?: string | null
          verify_ref?: string | null
          verify_started_at?: string | null
        }
        Update: {
          closed_at?: string | null
          closed_evidence?: string | null
          count?: number
          fingerprint?: string
          first_seen?: string
          id?: string
          last_seen?: string
          reopen_count?: number
          sample?: string | null
          sample_ref?: Json
          severity?: string
          source?: string
          source_kind?: string
          status?: string
          title?: string
          updated_at?: string
          verify_kind?: string
          verify_note?: string | null
          verify_ref?: string | null
          verify_started_at?: string | null
        }
        Relationships: []
      }
      ops_alert_pending: {
        Row: {
          id: string
          queued_at: string
          sample: string | null
          sample_ref: Json | null
          seen_at: string
          severity: string | null
          source: string | null
          source_kind: string
          title: string | null
          verify_kind: string | null
          verify_ref: string | null
        }
        Insert: {
          id?: string
          queued_at?: string
          sample?: string | null
          sample_ref?: Json | null
          seen_at: string
          severity?: string | null
          source?: string | null
          source_kind: string
          title?: string | null
          verify_kind?: string | null
          verify_ref?: string | null
        }
        Update: {
          id?: string
          queued_at?: string
          sample?: string | null
          sample_ref?: Json | null
          seen_at?: string
          severity?: string | null
          source?: string | null
          source_kind?: string
          title?: string | null
          verify_kind?: string | null
          verify_ref?: string | null
        }
        Relationships: []
      }
      ops_route_probe: {
        Row: {
          passed_at: string
          route: string
          run_ref: string | null
        }
        Insert: {
          passed_at: string
          route: string
          run_ref?: string | null
        }
        Update: {
          passed_at?: string
          route?: string
          run_ref?: string | null
        }
        Relationships: []
      }
      parish_match_alert_queue: {
        Row: {
          attempts: number
          created_at: string
          id: string
          job_id: string
          notify_at: string
          retry_after: string | null
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          job_id: string
          notify_at: string
          retry_after?: string | null
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          job_id?: string
          notify_at?: string
          retry_after?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parish_match_alert_queue_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parish_match_alert_queue_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parish_match_alert_queue_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      payee_accounts: {
        Row: {
          created_at: string
          env: string
          payable: boolean
          paypal_email: string | null
          paypal_payer_id: string | null
          provider: string
          updated_at: string
          user_id: string
          venmo_handle: string | null
          verified: boolean
        }
        Insert: {
          created_at?: string
          env: string
          payable?: boolean
          paypal_email?: string | null
          paypal_payer_id?: string | null
          provider: string
          updated_at?: string
          user_id: string
          venmo_handle?: string | null
          verified?: boolean
        }
        Update: {
          created_at?: string
          env?: string
          payable?: boolean
          paypal_email?: string | null
          paypal_payer_id?: string | null
          provider?: string
          updated_at?: string
          user_id?: string
          venmo_handle?: string | null
          verified?: boolean
        }
        Relationships: []
      }
      payment_fingerprints: {
        Row: {
          fingerprint_kind: string
          fingerprint_sha256: string
          first_seen_at: string
          last_seen_at: string
          user_id: string
        }
        Insert: {
          fingerprint_kind: string
          fingerprint_sha256: string
          first_seen_at?: string
          last_seen_at?: string
          user_id: string
        }
        Update: {
          fingerprint_kind?: string
          fingerprint_sha256?: string
          first_seen_at?: string
          last_seen_at?: string
          user_id?: string
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
      payout_failures: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          failed_at: string
          failure_code: string | null
          id: string
          resolved_at: string | null
          stripe_account_id: string
          stripe_event_id: string
          stripe_payout_id: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          failed_at?: string
          failure_code?: string | null
          id?: string
          resolved_at?: string | null
          stripe_account_id: string
          stripe_event_id: string
          stripe_payout_id: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          failed_at?: string
          failure_code?: string | null
          id?: string
          resolved_at?: string | null
          stripe_account_id?: string
          stripe_event_id?: string
          stripe_payout_id?: string
          user_id?: string
        }
        Relationships: []
      }
      payout_holds: {
        Row: {
          denied_at: string | null
          denied_by: string | null
          denied_reason: string | null
          held_at: string
          held_by: string | null
          helper_id: string
          reason: string
        }
        Insert: {
          denied_at?: string | null
          denied_by?: string | null
          denied_reason?: string | null
          held_at?: string
          held_by?: string | null
          helper_id: string
          reason: string
        }
        Update: {
          denied_at?: string | null
          denied_by?: string | null
          denied_reason?: string | null
          held_at?: string
          held_by?: string | null
          helper_id?: string
          reason?: string
        }
        Relationships: []
      }
      payout_payee_reminders: {
        Row: {
          last_reminded_at: string
          payee_id: string
        }
        Insert: {
          last_reminded_at?: string
          payee_id: string
        }
        Update: {
          last_reminded_at?: string
          payee_id?: string
        }
        Relationships: []
      }
      payout_payee_waits: {
        Row: {
          category: string
          first_waiting_at: string
          last_checked_at: string
          last_reason: string
          last_reminded_at: string | null
          ops_paged_at: string | null
          paged_category: string | null
          payee_id: string | null
          payout_id: string
          payout_kind: string
        }
        Insert: {
          category?: string
          first_waiting_at?: string
          last_checked_at?: string
          last_reason: string
          last_reminded_at?: string | null
          ops_paged_at?: string | null
          paged_category?: string | null
          payee_id?: string | null
          payout_id: string
          payout_kind: string
        }
        Update: {
          category?: string
          first_waiting_at?: string
          last_checked_at?: string
          last_reason?: string
          last_reminded_at?: string | null
          ops_paged_at?: string | null
          paged_category?: string | null
          payee_id?: string | null
          payout_id?: string
          payout_kind?: string
        }
        Relationships: []
      }
      payout_schedule_freezes: {
        Row: {
          alerted_at: string | null
          attempts: number
          freeze_error: string | null
          freeze_state: string
          helper_id: string
          prior_schedule: Json | null
          requested_at: string
          requested_by: string | null
          stripe_account_id: string | null
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          alerted_at?: string | null
          attempts?: number
          freeze_error?: string | null
          freeze_state: string
          helper_id: string
          prior_schedule?: Json | null
          requested_at?: string
          requested_by?: string | null
          stripe_account_id?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          alerted_at?: string | null
          attempts?: number
          freeze_error?: string | null
          freeze_state?: string
          helper_id?: string
          prior_schedule?: Json | null
          requested_at?: string
          requested_by?: string | null
          stripe_account_id?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      payout_send_marks: {
        Row: {
          marked_at: string
          payout_id: string
          payout_kind: string
        }
        Insert: {
          marked_at?: string
          payout_id: string
          payout_kind: string
        }
        Update: {
          marked_at?: string
          payout_id?: string
          payout_kind?: string
        }
        Relationships: []
      }
      payout_settlements: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          off_stripe_note: string | null
          row_id: string
          row_kind: string
          stripe_ref: string | null
          voided_at: string | null
          voided_reason: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          off_stripe_note?: string | null
          row_id: string
          row_kind: string
          stripe_ref?: string | null
          voided_at?: string | null
          voided_reason?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          off_stripe_note?: string | null
          row_id?: string
          row_kind?: string
          stripe_ref?: string | null
          voided_at?: string | null
          voided_reason?: string | null
        }
        Relationships: []
      }
      payout_setup_reminders: {
        Row: {
          claimed_at: string
          helper_id: string
          job_id: string | null
          reminder_key: string
          reminder_stage: string
          sent_at: string | null
        }
        Insert: {
          claimed_at?: string
          helper_id: string
          job_id?: string | null
          reminder_key: string
          reminder_stage: string
          sent_at?: string | null
        }
        Update: {
          claimed_at?: string
          helper_id?: string
          job_id?: string | null
          reminder_key?: string
          reminder_stage?: string
          sent_at?: string | null
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
          helper_id: string | null
          helper_redacted_at: string | null
          id: string
          initiated_by: string
          initiated_by_user_id: string | null
          job_id: string
          metadata: Json
          paid_at: string | null
          platform_fee_cents: number
          reversed_at: string | null
          status: string
          stripe_account_id: string | null
          stripe_transfer_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          failed_at?: string | null
          failure_reason?: string | null
          helper_id?: string | null
          helper_redacted_at?: string | null
          id?: string
          initiated_by?: string
          initiated_by_user_id?: string | null
          job_id: string
          metadata?: Json
          paid_at?: string | null
          platform_fee_cents?: number
          reversed_at?: string | null
          status?: string
          stripe_account_id?: string | null
          stripe_transfer_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          failed_at?: string | null
          failure_reason?: string | null
          helper_id?: string | null
          helper_redacted_at?: string | null
          id?: string
          initiated_by?: string
          initiated_by_user_id?: string | null
          job_id?: string
          metadata?: Json
          paid_at?: string | null
          platform_fee_cents?: number
          reversed_at?: string | null
          status?: string
          stripe_account_id?: string | null
          stripe_transfer_id?: string | null
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
      paypal_webhook_events: {
        Row: {
          env: string
          error: string | null
          event_id: string
          event_type: string
          payload: Json
          processed_at: string | null
          received_at: string
          resource_id: string | null
          resource_type: string | null
        }
        Insert: {
          env: string
          error?: string | null
          event_id: string
          event_type: string
          payload: Json
          processed_at?: string | null
          received_at?: string
          resource_id?: string | null
          resource_type?: string | null
        }
        Update: {
          env?: string
          error?: string | null
          event_id?: string
          event_type?: string
          payload?: Json
          processed_at?: string | null
          received_at?: string
          resource_id?: string | null
          resource_type?: string | null
        }
        Relationships: []
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
      platform_settings: {
        Row: {
          application_cap_per_hour: number | null
          application_cap_per_minute: number | null
          customer_fee_percent: number
          daily_application_cap: number | null
          feature_flags: Json
          helper_fee_percent: number
          homes_sale_listing_fee_cents: number
          hybrid_idv_enabled: boolean
          id: string
          idv_auto_approve_threshold: number
          min_supported_build: number
          onboarding_fee_cents: number
          platform_fee_percent: number
          signup_rate_limit_per_hour: number | null
          social_webhook_url: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          application_cap_per_hour?: number | null
          application_cap_per_minute?: number | null
          customer_fee_percent?: number
          daily_application_cap?: number | null
          feature_flags?: Json
          helper_fee_percent?: number
          homes_sale_listing_fee_cents?: number
          hybrid_idv_enabled?: boolean
          id?: string
          idv_auto_approve_threshold?: number
          min_supported_build?: number
          onboarding_fee_cents?: number
          platform_fee_percent?: number
          signup_rate_limit_per_hour?: number | null
          social_webhook_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          application_cap_per_hour?: number | null
          application_cap_per_minute?: number | null
          customer_fee_percent?: number
          daily_application_cap?: number | null
          feature_flags?: Json
          helper_fee_percent?: number
          homes_sale_listing_fee_cents?: number
          hybrid_idv_enabled?: boolean
          id?: string
          idv_auto_approve_threshold?: number
          min_supported_build?: number
          onboarding_fee_cents?: number
          platform_fee_percent?: number
          signup_rate_limit_per_hour?: number | null
          social_webhook_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      pre_verification_wipes: {
        Row: {
          error: string | null
          id: string
          objects: Json
          storage_done_at: string | null
          user_id: string
          wiped_at: string
        }
        Insert: {
          error?: string | null
          id?: string
          objects?: Json
          storage_done_at?: string | null
          user_id: string
          wiped_at?: string
        }
        Update: {
          error?: string | null
          id?: string
          objects?: Json
          storage_done_at?: string | null
          user_id?: string
          wiped_at?: string
        }
        Relationships: []
      }
      profile_search_rate_log: {
        Row: {
          created_at: string
          id: number
          searcher_id: string
        }
        Insert: {
          created_at?: string
          id?: number
          searcher_id: string
        }
        Update: {
          created_at?: string
          id?: number
          searcher_id?: string
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
          age_attested_at: string | null
          anonymized_at: string | null
          apple_original_transaction_id: string | null
          application_count: number
          approval_email_count: number
          auto_release_on_complete: boolean
          auto_suspended_until: string | null
          auto_tip_cap: number | null
          auto_tip_enabled_at: string | null
          auto_tip_mode: Database["public"]["Enums"]["auto_tip_mode"]
          auto_tip_value: number | null
          availability: string | null
          available_until: string | null
          avatar_url: string | null
          background_check_status: string
          ban_status: string | null
          bio: string | null
          boost_credit_used_count: number
          boost_credit_used_month: string | null
          business_name: string | null
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
          id_verification_status: string
          identity_sha256: string | null
          idv_attempt_count: number
          idv_attempted_at: string | null
          idv_confidence: number | null
          idv_failure_reason: string | null
          idv_session_id: string | null
          idv_status: string | null
          insurance_expires_at: string | null
          insurance_rejection_reason: string | null
          insurance_reviewed_at: string | null
          insurance_reviewed_by: string | null
          insurance_status: string
          insurance_url: string | null
          is_insured: boolean
          is_legacy_user: boolean
          is_licensed: boolean
          is_seed: boolean
          last_approval_email_at: string | null
          last_denial_email_at: string | null
          last_drip_at: string | null
          last_verification_email_at: string | null
          latitude: number | null
          legacy_manual_review: boolean
          license_expires_at: string | null
          license_rejection_reason: string | null
          license_reviewed_at: string | null
          license_reviewed_by: string | null
          license_status: string
          license_url: string | null
          location: string | null
          location_captured_at: string | null
          longitude: number | null
          marketing_consent: boolean
          onboarding_fee_charged_at: string | null
          onboarding_fee_paid: boolean
          onboarding_tour_completed_at: string | null
          parish: string | null
          parish_source: string | null
          phone: string | null
          portfolio_urls: string[] | null
          preferred_helper_id: string | null
          promotions_before_unsubscribe: Json | null
          saved_helper_seen: Json
          senior_mode: boolean
          share_job_photos: boolean
          skills: string | null
          stripe_account_id: string | null
          stripe_charges_enabled: boolean
          stripe_customer_id: string | null
          stripe_identity_verified: boolean
          stripe_identity_verified_at: string | null
          stripe_payouts_enabled: boolean
          stripe_subscription_id: string | null
          subscription_billing_cycle: string | null
          subscription_cancel_at_period_end: boolean
          subscription_expires_at: string | null
          subscription_source: string | null
          subscription_tier: string | null
          terms_accepted_at: string | null
          terms_version_accepted: string
          tools_equipment: string | null
          transportation: string | null
          under_13_blocked_at: string | null
          under_13_waiting_since: string | null
          updated_at: string
          user_id: string
          verification_email_count: number
          zip_code: string | null
        }
        Insert: {
          accepted_terms_at?: string | null
          age_attested_at?: string | null
          anonymized_at?: string | null
          apple_original_transaction_id?: string | null
          application_count?: number
          approval_email_count?: number
          auto_release_on_complete?: boolean
          auto_suspended_until?: string | null
          auto_tip_cap?: number | null
          auto_tip_enabled_at?: string | null
          auto_tip_mode?: Database["public"]["Enums"]["auto_tip_mode"]
          auto_tip_value?: number | null
          availability?: string | null
          available_until?: string | null
          avatar_url?: string | null
          background_check_status?: string
          ban_status?: string | null
          bio?: string | null
          boost_credit_used_count?: number
          boost_credit_used_month?: string | null
          business_name?: string | null
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
          id_verification_status?: string
          identity_sha256?: string | null
          idv_attempt_count?: number
          idv_attempted_at?: string | null
          idv_confidence?: number | null
          idv_failure_reason?: string | null
          idv_session_id?: string | null
          idv_status?: string | null
          insurance_expires_at?: string | null
          insurance_rejection_reason?: string | null
          insurance_reviewed_at?: string | null
          insurance_reviewed_by?: string | null
          insurance_status?: string
          insurance_url?: string | null
          is_insured?: boolean
          is_legacy_user?: boolean
          is_licensed?: boolean
          is_seed?: boolean
          last_approval_email_at?: string | null
          last_denial_email_at?: string | null
          last_drip_at?: string | null
          last_verification_email_at?: string | null
          latitude?: number | null
          legacy_manual_review?: boolean
          license_expires_at?: string | null
          license_rejection_reason?: string | null
          license_reviewed_at?: string | null
          license_reviewed_by?: string | null
          license_status?: string
          license_url?: string | null
          location?: string | null
          location_captured_at?: string | null
          longitude?: number | null
          marketing_consent?: boolean
          onboarding_fee_charged_at?: string | null
          onboarding_fee_paid?: boolean
          onboarding_tour_completed_at?: string | null
          parish?: string | null
          parish_source?: string | null
          phone?: string | null
          portfolio_urls?: string[] | null
          preferred_helper_id?: string | null
          promotions_before_unsubscribe?: Json | null
          saved_helper_seen?: Json
          senior_mode?: boolean
          share_job_photos?: boolean
          skills?: string | null
          stripe_account_id?: string | null
          stripe_charges_enabled?: boolean
          stripe_customer_id?: string | null
          stripe_identity_verified?: boolean
          stripe_identity_verified_at?: string | null
          stripe_payouts_enabled?: boolean
          stripe_subscription_id?: string | null
          subscription_billing_cycle?: string | null
          subscription_cancel_at_period_end?: boolean
          subscription_expires_at?: string | null
          subscription_source?: string | null
          subscription_tier?: string | null
          terms_accepted_at?: string | null
          terms_version_accepted?: string
          tools_equipment?: string | null
          transportation?: string | null
          under_13_blocked_at?: string | null
          under_13_waiting_since?: string | null
          updated_at?: string
          user_id: string
          verification_email_count?: number
          zip_code?: string | null
        }
        Update: {
          accepted_terms_at?: string | null
          age_attested_at?: string | null
          anonymized_at?: string | null
          apple_original_transaction_id?: string | null
          application_count?: number
          approval_email_count?: number
          auto_release_on_complete?: boolean
          auto_suspended_until?: string | null
          auto_tip_cap?: number | null
          auto_tip_enabled_at?: string | null
          auto_tip_mode?: Database["public"]["Enums"]["auto_tip_mode"]
          auto_tip_value?: number | null
          availability?: string | null
          available_until?: string | null
          avatar_url?: string | null
          background_check_status?: string
          ban_status?: string | null
          bio?: string | null
          boost_credit_used_count?: number
          boost_credit_used_month?: string | null
          business_name?: string | null
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
          id_verification_status?: string
          identity_sha256?: string | null
          idv_attempt_count?: number
          idv_attempted_at?: string | null
          idv_confidence?: number | null
          idv_failure_reason?: string | null
          idv_session_id?: string | null
          idv_status?: string | null
          insurance_expires_at?: string | null
          insurance_rejection_reason?: string | null
          insurance_reviewed_at?: string | null
          insurance_reviewed_by?: string | null
          insurance_status?: string
          insurance_url?: string | null
          is_insured?: boolean
          is_legacy_user?: boolean
          is_licensed?: boolean
          is_seed?: boolean
          last_approval_email_at?: string | null
          last_denial_email_at?: string | null
          last_drip_at?: string | null
          last_verification_email_at?: string | null
          latitude?: number | null
          legacy_manual_review?: boolean
          license_expires_at?: string | null
          license_rejection_reason?: string | null
          license_reviewed_at?: string | null
          license_reviewed_by?: string | null
          license_status?: string
          license_url?: string | null
          location?: string | null
          location_captured_at?: string | null
          longitude?: number | null
          marketing_consent?: boolean
          onboarding_fee_charged_at?: string | null
          onboarding_fee_paid?: boolean
          onboarding_tour_completed_at?: string | null
          parish?: string | null
          parish_source?: string | null
          phone?: string | null
          portfolio_urls?: string[] | null
          preferred_helper_id?: string | null
          promotions_before_unsubscribe?: Json | null
          saved_helper_seen?: Json
          senior_mode?: boolean
          share_job_photos?: boolean
          skills?: string | null
          stripe_account_id?: string | null
          stripe_charges_enabled?: boolean
          stripe_customer_id?: string | null
          stripe_identity_verified?: boolean
          stripe_identity_verified_at?: string | null
          stripe_payouts_enabled?: boolean
          stripe_subscription_id?: string | null
          subscription_billing_cycle?: string | null
          subscription_cancel_at_period_end?: boolean
          subscription_expires_at?: string | null
          subscription_source?: string | null
          subscription_tier?: string | null
          terms_accepted_at?: string | null
          terms_version_accepted?: string
          tools_equipment?: string | null
          transportation?: string | null
          under_13_blocked_at?: string | null
          under_13_waiting_since?: string | null
          updated_at?: string
          user_id?: string
          verification_email_count?: number
          zip_code?: string | null
        }
        Relationships: []
      }
      provider_payments: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          env: string
          id: string
          idempotency_key: string
          payer_id: string | null
          provider: string
          provider_capture_id: string | null
          provider_order_id: string
          status: string
          subject_id: string
          subject_kind: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          env: string
          id?: string
          idempotency_key: string
          payer_id?: string | null
          provider: string
          provider_capture_id?: string | null
          provider_order_id: string
          status?: string
          subject_id: string
          subject_kind: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          env?: string
          id?: string
          idempotency_key?: string
          payer_id?: string | null
          provider?: string
          provider_capture_id?: string | null
          provider_order_id?: string
          status?: string
          subject_id?: string
          subject_kind?: string
          updated_at?: string
        }
        Relationships: []
      }
      provider_payouts: {
        Row: {
          amount_cents: number
          created_at: string
          destination_kind: string
          destination_value: string
          env: string
          external_txn_id: string | null
          fee_cents: number | null
          id: string
          marked_paid_at: string | null
          marked_paid_by: string | null
          payee_user_id: string | null
          payout_transfer_id: string
          provider: string
          provider_batch_id: string | null
          provider_item_id: string | null
          provider_payment_id: string
          return_ref: string | null
          sender_batch_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          destination_kind: string
          destination_value: string
          env: string
          external_txn_id?: string | null
          fee_cents?: number | null
          id?: string
          marked_paid_at?: string | null
          marked_paid_by?: string | null
          payee_user_id?: string | null
          payout_transfer_id: string
          provider: string
          provider_batch_id?: string | null
          provider_item_id?: string | null
          provider_payment_id: string
          return_ref?: string | null
          sender_batch_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          destination_kind?: string
          destination_value?: string
          env?: string
          external_txn_id?: string | null
          fee_cents?: number | null
          id?: string
          marked_paid_at?: string | null
          marked_paid_by?: string | null
          payee_user_id?: string | null
          payout_transfer_id?: string
          provider?: string
          provider_batch_id?: string | null
          provider_item_id?: string | null
          provider_payment_id?: string
          return_ref?: string | null
          sender_batch_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_payouts_payout_transfer_id_fkey"
            columns: ["payout_transfer_id"]
            isOneToOne: true
            referencedRelation: "payout_transfers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_payouts_provider_payment_id_fkey"
            columns: ["provider_payment_id"]
            isOneToOne: false
            referencedRelation: "provider_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_refunds: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          idempotency_key: string
          provider_payment_id: string
          provider_refund_id: string | null
          reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          idempotency_key: string
          provider_payment_id: string
          provider_refund_id?: string | null
          reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          idempotency_key?: string
          provider_payment_id?: string
          provider_refund_id?: string | null
          reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_refunds_provider_payment_id_fkey"
            columns: ["provider_payment_id"]
            isOneToOne: false
            referencedRelation: "provider_payments"
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
          last_seen_at: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_seen_at?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_seen_at?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
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
      recurring_visit_payments: {
        Row: {
          amount_cents: number
          budget_cents: number
          child_job_id: string | null
          created_at: string
          fee_cents: number
          fee_percent: number
          helper_id: string | null
          hold_id: string | null
          id: string
          paid_at: string | null
          parent_job_id: string
          payer_id: string | null
          status: string
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          tax_calculation_id: string | null
          tax_cents: number
          updated_at: string
          visit_date: string
        }
        Insert: {
          amount_cents: number
          budget_cents: number
          child_job_id?: string | null
          created_at?: string
          fee_cents: number
          fee_percent: number
          helper_id?: string | null
          hold_id?: string | null
          id?: string
          paid_at?: string | null
          parent_job_id: string
          payer_id?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          tax_calculation_id?: string | null
          tax_cents?: number
          updated_at?: string
          visit_date: string
        }
        Update: {
          amount_cents?: number
          budget_cents?: number
          child_job_id?: string | null
          created_at?: string
          fee_cents?: number
          fee_percent?: number
          helper_id?: string | null
          hold_id?: string | null
          id?: string
          paid_at?: string | null
          parent_job_id?: string
          payer_id?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          tax_calculation_id?: string | null
          tax_cents?: number
          updated_at?: string
          visit_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_visit_payments_child_job_id_fkey"
            columns: ["child_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_visit_payments_child_job_id_fkey"
            columns: ["child_job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_visit_payments_child_job_id_fkey"
            columns: ["child_job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_visit_payments_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_visit_payments_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_visit_payments_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_visit_releases: {
        Row: {
          created_at: string
          helper_id: string
          id: string
          parent_job_id: string
          reason: string | null
          visit_date: string
        }
        Insert: {
          created_at?: string
          helper_id: string
          id?: string
          parent_job_id: string
          reason?: string | null
          visit_date: string
        }
        Update: {
          created_at?: string
          helper_id?: string
          id?: string
          parent_job_id?: string
          reason?: string | null
          visit_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_visit_releases_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_visit_releases_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_visit_releases_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_codes: {
        Row: {
          code: string
          created_at: string
          id: string
          user_id: string | null
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          user_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          user_id?: string | null
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
          redeemed_at: string | null
          referral_code_id: string | null
          referred_user_id: string | null
          stripe_transfer_id: string | null
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          reason: string
          redeemed?: boolean
          redeemed_at?: string | null
          referral_code_id?: string | null
          referred_user_id?: string | null
          stripe_transfer_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          reason?: string
          redeemed?: boolean
          redeemed_at?: string | null
          referral_code_id?: string | null
          referred_user_id?: string | null
          stripe_transfer_id?: string | null
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
          referrer_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          referral_code_id: string
          referred_id: string
          referrer_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          referral_code_id?: string
          referred_id?: string
          referrer_id?: string | null
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
      refund_notices: {
        Row: {
          amount_cents: number
          created_at: string
          email_attempts: number
          email_error: string | null
          emailed: boolean
          job_id: string | null
          notice_key: string
          notification_id: string | null
          payment_intent_id: string | null
          user_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          email_attempts?: number
          email_error?: string | null
          emailed?: boolean
          job_id?: string | null
          notice_key: string
          notification_id?: string | null
          payment_intent_id?: string | null
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          email_attempts?: number
          email_error?: string | null
          emailed?: boolean
          job_id?: string | null
          notice_key?: string
          notification_id?: string | null
          payment_intent_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_notices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_requests: {
        Row: {
          amount_cents: number
          answer_by: string
          answered_at: string | null
          answered_by: string | null
          budget_cents: number
          closed_reason: string | null
          created_at: string
          dispute_id: string | null
          id: string
          job_id: string
          last_settle_at: string | null
          reason: string
          requester_id: string | null
          responder_id: string | null
          schedule_change_id: string | null
          refund_scope: string
          settle_attempts: number
          status: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          answer_by: string
          answered_at?: string | null
          answered_by?: string | null
          budget_cents: number
          closed_reason?: string | null
          created_at?: string
          dispute_id?: string | null
          id?: string
          job_id: string
          last_settle_at?: string | null
          reason: string
          requester_id?: string | null
          responder_id?: string | null
          schedule_change_id?: string | null
          refund_scope: string
          settle_attempts?: number
          status?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          answer_by?: string
          answered_at?: string | null
          answered_by?: string | null
          budget_cents?: number
          closed_reason?: string | null
          created_at?: string
          dispute_id?: string | null
          id?: string
          job_id?: string
          last_settle_at?: string | null
          reason?: string
          requester_id?: string | null
          responder_id?: string | null
          schedule_change_id?: string | null
          refund_scope?: string
          settle_attempts?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_requests_dispute_id_fkey"
            columns: ["dispute_id"]
            isOneToOne: false
            referencedRelation: "disputes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_schedule_change_id_fkey"
            columns: ["schedule_change_id"]
            isOneToOne: false
            referencedRelation: "job_schedule_change_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_deposits: {
        Row: {
          address_shared_noticed_at: string | null
          amount_cents: number | null
          created_at: string
          deductions: Json
          forwarding_address: string | null
          received_on: string | null
          reminded_stage: number
          returned_cents: number | null
          returned_on: string | null
          settled_at: string | null
          tenancy_id: string
          updated_at: string
        }
        Insert: {
          address_shared_noticed_at?: string | null
          amount_cents?: number | null
          created_at?: string
          deductions?: Json
          forwarding_address?: string | null
          received_on?: string | null
          reminded_stage?: number
          returned_cents?: number | null
          returned_on?: string | null
          settled_at?: string | null
          tenancy_id: string
          updated_at?: string
        }
        Update: {
          address_shared_noticed_at?: string | null
          amount_cents?: number | null
          created_at?: string
          deductions?: Json
          forwarding_address?: string | null
          received_on?: string | null
          reminded_stage?: number
          returned_cents?: number | null
          returned_on?: string | null
          settled_at?: string | null
          tenancy_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_deposits_tenancy_id_fkey"
            columns: ["tenancy_id"]
            isOneToOne: true
            referencedRelation: "rental_tenancies"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_leases: {
        Row: {
          blanks_sha256: string | null
          body_sha256: string | null
          change_request: string | null
          created_at: string
          fields: Json
          home_label: string | null
          id: string
          landlord_consent_at: string | null
          landlord_id: string | null
          landlord_initials: string[]
          landlord_signed_at: string | null
          landlord_signed_name: string | null
          sent_at: string | null
          status: string
          template_version: string
          tenancy_id: string | null
          tenant_consent_at: string | null
          tenant_id: string | null
          tenant_initials: string[]
          tenant_signed_at: string | null
          tenant_signed_name: string | null
          updated_at: string
        }
        Insert: {
          blanks_sha256?: string | null
          body_sha256?: string | null
          change_request?: string | null
          created_at?: string
          fields?: Json
          home_label?: string | null
          id?: string
          landlord_consent_at?: string | null
          landlord_id?: string | null
          landlord_initials?: string[]
          landlord_signed_at?: string | null
          landlord_signed_name?: string | null
          sent_at?: string | null
          status?: string
          template_version: string
          tenancy_id?: string | null
          tenant_consent_at?: string | null
          tenant_id?: string | null
          tenant_initials?: string[]
          tenant_signed_at?: string | null
          tenant_signed_name?: string | null
          updated_at?: string
        }
        Update: {
          blanks_sha256?: string | null
          body_sha256?: string | null
          change_request?: string | null
          created_at?: string
          fields?: Json
          home_label?: string | null
          id?: string
          landlord_consent_at?: string | null
          landlord_id?: string | null
          landlord_initials?: string[]
          landlord_signed_at?: string | null
          landlord_signed_name?: string | null
          sent_at?: string | null
          status?: string
          template_version?: string
          tenancy_id?: string | null
          tenant_consent_at?: string | null
          tenant_id?: string | null
          tenant_initials?: string[]
          tenant_signed_at?: string | null
          tenant_signed_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_leases_tenancy_id_fkey"
            columns: ["tenancy_id"]
            isOneToOne: false
            referencedRelation: "rental_tenancies"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_listing_photos: {
        Row: {
          created_at: string
          id: string
          listing_id: string
          owner_id: string
          position: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          listing_id: string
          owner_id: string
          position: number
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          listing_id?: string
          owner_id?: string
          position?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_listing_photos_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "rental_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_listings: {
        Row: {
          accepts_vouchers: string
          accessibility: string[]
          available_on: string | null
          baths: number
          beds: number
          created_at: string
          deposit_cents: number | null
          description: string
          expires_at: string | null
          headline: string
          id: string
          kind: string
          lease_months_max: number | null
          lease_months_min: number | null
          lot_sq_ft: number | null
          owner_id: string
          parking: string
          pet_rules: string
          pets: string
          property_id: string
          published_at: string | null
          removed_by_admin: boolean
          removed_from_status: string | null
          removed_reason: string | null
          rent_cents: number | null
          rent_frequency: string
          sale_price_cents: number | null
          slug: string
          sq_ft: number | null
          status: string
          unit_id: string | null
          updated_at: string
          utilities_included: string[]
          wording_flags: string[]
          year_built: number | null
        }
        Insert: {
          accepts_vouchers?: string
          accessibility?: string[]
          available_on?: string | null
          baths: number
          beds: number
          created_at?: string
          deposit_cents?: number | null
          description?: string
          expires_at?: string | null
          headline: string
          id?: string
          kind?: string
          lease_months_max?: number | null
          lease_months_min?: number | null
          lot_sq_ft?: number | null
          owner_id: string
          parking?: string
          pet_rules?: string
          pets?: string
          property_id: string
          published_at?: string | null
          removed_by_admin?: boolean
          removed_from_status?: string | null
          removed_reason?: string | null
          rent_cents?: number | null
          rent_frequency?: string
          sale_price_cents?: number | null
          slug?: string
          sq_ft?: number | null
          status?: string
          unit_id?: string | null
          updated_at?: string
          utilities_included?: string[]
          wording_flags?: string[]
          year_built?: number | null
        }
        Update: {
          accepts_vouchers?: string
          accessibility?: string[]
          available_on?: string | null
          baths?: number
          beds?: number
          created_at?: string
          deposit_cents?: number | null
          description?: string
          expires_at?: string | null
          headline?: string
          id?: string
          kind?: string
          lease_months_max?: number | null
          lease_months_min?: number | null
          lot_sq_ft?: number | null
          owner_id?: string
          parking?: string
          pet_rules?: string
          pets?: string
          property_id?: string
          published_at?: string | null
          removed_by_admin?: boolean
          removed_from_status?: string | null
          removed_reason?: string | null
          rent_cents?: number | null
          rent_frequency?: string
          sale_price_cents?: number | null
          slug?: string
          sq_ft?: number | null
          status?: string
          unit_id?: string | null
          updated_at?: string
          utilities_included?: string[]
          wording_flags?: string[]
          year_built?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rental_listings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "rental_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_listings_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "rental_units"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_photo_purge_queue: {
        Row: {
          bucket_id: string
          claimed_at: string | null
          created_at: string
          due_at: string
          reason: string
          storage_path: string
        }
        Insert: {
          bucket_id: string
          claimed_at?: string | null
          created_at?: string
          due_at: string
          reason: string
          storage_path: string
        }
        Update: {
          bucket_id?: string
          claimed_at?: string | null
          created_at?: string
          due_at?: string
          reason?: string
          storage_path?: string
        }
        Relationships: []
      }
      rental_properties: {
        Row: {
          auto_approve_limit_cents: number | null
          city: string
          created_at: string
          id: string
          label: string
          listings_taken_down_at: string | null
          listings_taken_down_reason: string | null
          owner_id: string
          ownership_proof_path: string | null
          ownership_review_note: string | null
          ownership_reviewed_at: string | null
          ownership_reviewed_by: string | null
          ownership_status: string
          ownership_submitted_at: string | null
          street_address: string
          updated_at: string
          zip_code: string
        }
        Insert: {
          auto_approve_limit_cents?: number | null
          city: string
          created_at?: string
          id?: string
          label: string
          listings_taken_down_at?: string | null
          listings_taken_down_reason?: string | null
          owner_id: string
          ownership_proof_path?: string | null
          ownership_review_note?: string | null
          ownership_reviewed_at?: string | null
          ownership_reviewed_by?: string | null
          ownership_status?: string
          ownership_submitted_at?: string | null
          street_address: string
          updated_at?: string
          zip_code: string
        }
        Update: {
          auto_approve_limit_cents?: number | null
          city?: string
          created_at?: string
          id?: string
          label?: string
          listings_taken_down_at?: string | null
          listings_taken_down_reason?: string | null
          owner_id?: string
          ownership_proof_path?: string | null
          ownership_review_note?: string | null
          ownership_reviewed_at?: string | null
          ownership_reviewed_by?: string | null
          ownership_status?: string
          ownership_submitted_at?: string | null
          street_address?: string
          updated_at?: string
          zip_code?: string
        }
        Relationships: []
      }
      rental_rent_charges: {
        Row: {
          amount_cents: number
          created_at: string
          due_on: string
          grace_days: number
          id: string
          kind: string
          late_fee_cents: number
          on_time_at: string | null
          rent_charge_id: string | null
          tenancy_id: string
          waived_at: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          due_on: string
          grace_days?: number
          id?: string
          kind: string
          late_fee_cents?: number
          on_time_at?: string | null
          rent_charge_id?: string | null
          tenancy_id: string
          waived_at?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          due_on?: string
          grace_days?: number
          id?: string
          kind?: string
          late_fee_cents?: number
          on_time_at?: string | null
          rent_charge_id?: string | null
          tenancy_id?: string
          waived_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rental_rent_charges_rent_charge_id_fkey"
            columns: ["rent_charge_id"]
            isOneToOne: false
            referencedRelation: "rental_rent_charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_rent_charges_tenancy_id_fkey"
            columns: ["tenancy_id"]
            isOneToOne: false
            referencedRelation: "rental_tenancies"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_rent_payments: {
        Row: {
          amount_cents: number
          corrections: Json
          created_at: string
          decided_at: string | null
          decline_reason: string | null
          id: string
          paid_on: string
          pay_method: string
          reported_by: string
          status: string
          tenancy_id: string
          tenant_disputes: Json
        }
        Insert: {
          amount_cents: number
          corrections?: Json
          created_at?: string
          decided_at?: string | null
          decline_reason?: string | null
          id?: string
          paid_on: string
          pay_method: string
          reported_by: string
          status?: string
          tenancy_id: string
          tenant_disputes?: Json
        }
        Update: {
          amount_cents?: number
          corrections?: Json
          created_at?: string
          decided_at?: string | null
          decline_reason?: string | null
          id?: string
          paid_on?: string
          pay_method?: string
          reported_by?: string
          status?: string
          tenancy_id?: string
          tenant_disputes?: Json
        }
        Relationships: [
          {
            foreignKeyName: "rental_rent_payments_tenancy_id_fkey"
            columns: ["tenancy_id"]
            isOneToOne: false
            referencedRelation: "rental_tenancies"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_rent_plans: {
        Row: {
          amount_cents: number
          created_at: string
          first_due_on: string
          frequency: string
          grace_days: number
          late_fee_cents: number
          pay_methods: string[]
          reminded_for: string | null
          tenancy_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          first_due_on: string
          frequency: string
          grace_days?: number
          late_fee_cents?: number
          pay_methods?: string[]
          reminded_for?: string | null
          tenancy_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          first_due_on?: string
          frequency?: string
          grace_days?: number
          late_fee_cents?: number
          pay_methods?: string[]
          reminded_for?: string | null
          tenancy_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_rent_plans_tenancy_id_fkey"
            columns: ["tenancy_id"]
            isOneToOne: true
            referencedRelation: "rental_tenancies"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_rent_sweep_skips: {
        Row: {
          periods: Json
          tenancy_id: string
          updated_at: string
        }
        Insert: {
          periods?: Json
          tenancy_id: string
          updated_at?: string
        }
        Update: {
          periods?: Json
          tenancy_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_rent_sweep_skips_tenancy_id_fkey"
            columns: ["tenancy_id"]
            isOneToOne: true
            referencedRelation: "rental_tenancies"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_tenancies: {
        Row: {
          accepted_at: string | null
          created_at: string
          ended_at: string | null
          ended_by: string | null
          id: string
          invite_expires_at: string
          invite_token_sha256: string
          landlord_id: string
          lease_ends_on: string | null
          property_id: string
          status: string
          tenant_id: string | null
          unit_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          invite_expires_at: string
          invite_token_sha256: string
          landlord_id: string
          lease_ends_on?: string | null
          property_id: string
          status?: string
          tenant_id?: string | null
          unit_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          invite_expires_at?: string
          invite_token_sha256?: string
          landlord_id?: string
          lease_ends_on?: string | null
          property_id?: string
          status?: string
          tenant_id?: string | null
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_tenancies_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "rental_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_tenancies_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "rental_units"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_units: {
        Row: {
          created_at: string
          id: string
          label: string
          owner_id: string
          property_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          owner_id: string
          property_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          owner_id?: string
          property_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_units_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "rental_properties"
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
          reported_content: string | null
          reported_id: string
          reported_type: string
          reporter_id: string | null
          status: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          id?: string
          reason: string
          reported_content?: string | null
          reported_id: string
          reported_type: string
          reporter_id?: string | null
          status?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          id?: string
          reason?: string
          reported_content?: string | null
          reported_id?: string
          reported_type?: string
          reporter_id?: string | null
          status?: string
        }
        Relationships: []
      }
      retained_bans: {
        Row: {
          ban_status: string
          ban_type: string | null
          bank_sha256: string[]
          card_sha256: string[]
          email_sha256: string
          expires_at: string | null
          id: string
          identity_nodoc_sha256: string | null
          identity_sha256: string | null
          name_sha256: string | null
          phone_sha256: string | null
          phone7_sha256: string | null
          reapplied_at: string | null
          reason: string
          retained_at: string
          retained_via: string | null
        }
        Insert: {
          ban_status: string
          ban_type?: string | null
          bank_sha256?: string[]
          card_sha256?: string[]
          email_sha256: string
          expires_at?: string | null
          id?: string
          identity_nodoc_sha256?: string | null
          identity_sha256?: string | null
          name_sha256?: string | null
          phone_sha256?: string | null
          phone7_sha256?: string | null
          reapplied_at?: string | null
          reason: string
          retained_at?: string
          retained_via?: string | null
        }
        Update: {
          ban_status?: string
          ban_type?: string | null
          bank_sha256?: string[]
          card_sha256?: string[]
          email_sha256?: string
          expires_at?: string | null
          id?: string
          identity_nodoc_sha256?: string | null
          identity_sha256?: string | null
          name_sha256?: string | null
          phone_sha256?: string | null
          phone7_sha256?: string | null
          reapplied_at?: string | null
          reason?: string
          retained_at?: string
          retained_via?: string | null
        }
        Relationships: []
      }
      retired_client_relations: {
        Row: {
          first_stale_read_at: string | null
          last_stale_read_at: string | null
          relation: string
          retired_by: string
          stale_reads: number
        }
        Insert: {
          first_stale_read_at?: string | null
          last_stale_read_at?: string | null
          relation: string
          retired_by: string
          stale_reads?: number
        }
        Update: {
          first_stale_read_at?: string | null
          last_stale_read_at?: string | null
          relation?: string
          retired_by?: string
          stale_reads?: number
        }
        Relationships: []
      }
      reviews: {
        Row: {
          created_at: string
          feedback: string | null
          feedback_visible_at: string | null
          id: string
          job_id: string
          photo_urls: string[] | null
          rating: number
          response_at: string | null
          response_text: string | null
          reviewee_id: string
          reviewer_id: string | null
          status: string
        }
        Insert: {
          created_at?: string
          feedback?: string | null
          feedback_visible_at?: string | null
          id?: string
          job_id: string
          photo_urls?: string[] | null
          rating: number
          response_at?: string | null
          response_text?: string | null
          reviewee_id: string
          reviewer_id?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          feedback?: string | null
          feedback_visible_at?: string | null
          id?: string
          job_id?: string
          photo_urls?: string[] | null
          rating?: number
          response_at?: string | null
          response_text?: string | null
          reviewee_id?: string
          reviewer_id?: string | null
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
      rentals_photo_serve_keys: {
        Row: {
          created_at: string
          id: number
          secret: string
        }
        Insert: {
          created_at?: string
          id: number
          secret: string
        }
        Update: {
          created_at?: string
          id?: number
          secret?: string
        }
        Relationships: []
      }
      saved_homes: {
        Row: {
          created_at: string
          listing_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          listing_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          listing_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_homes_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "rental_listings"
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
      saved_search_alert_queue: {
        Row: {
          created_at: string
          id: string
          job_id: string
          matched_search_ids: string[]
          notify_at: string
          search_name: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          matched_search_ids?: string[]
          notify_at: string
          search_name?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          matched_search_ids?: string[]
          notify_at?: string
          search_name?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_search_alert_queue_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_search_alert_queue_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_search_alert_queue_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_search_item_matches: {
        Row: {
          at: string
          held: boolean
          item_id: string
          search_id: string
        }
        Insert: {
          at?: string
          held: boolean
          item_id: string
          search_id: string
        }
        Update: {
          at?: string
          held?: boolean
          item_id?: string
          search_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_search_item_matches_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "declutter_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_search_item_matches_search_id_fkey"
            columns: ["search_id"]
            isOneToOne: false
            referencedRelation: "saved_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_search_item_queue: {
        Row: {
          attempts: number
          item_id: string
          queued_at: string
          retry_after: string | null
        }
        Insert: {
          attempts?: number
          item_id: string
          queued_at?: string
          retry_after?: string | null
        }
        Update: {
          attempts?: number
          item_id?: string
          queued_at?: string
          retry_after?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saved_search_item_queue_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "declutter_items"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_searches: {
        Row: {
          category: string | null
          created_at: string
          conditions: number[]
          drops_only: boolean
          free_only: boolean
          porch_only: boolean
          id: string
          last_emailed_at: string | null
          last_notified_at: string | null
          last_seen_at: string | null
          location_keyword: string | null
          max_budget: number | null
          min_budget: number | null
          name: string
          notify_email: boolean
          notify_enabled: boolean
          parish: string | null
          origin_lat: number | null
          origin_lng: number | null
          query: string | null
          radius_miles: number | null
          section: string
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          conditions?: number[]
          drops_only?: boolean
          free_only?: boolean
          porch_only?: boolean
          id?: string
          last_emailed_at?: string | null
          last_notified_at?: string | null
          last_seen_at?: string | null
          location_keyword?: string | null
          max_budget?: number | null
          min_budget?: number | null
          name: string
          notify_email?: boolean
          notify_enabled?: boolean
          parish?: string | null
          origin_lat?: number | null
          origin_lng?: number | null
          query?: string | null
          radius_miles?: number | null
          section?: string
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          conditions?: number[]
          drops_only?: boolean
          free_only?: boolean
          porch_only?: boolean
          id?: string
          last_emailed_at?: string | null
          last_notified_at?: string | null
          last_seen_at?: string | null
          location_keyword?: string | null
          max_budget?: number | null
          min_budget?: number | null
          name?: string
          notify_email?: boolean
          notify_enabled?: boolean
          parish?: string | null
          origin_lat?: number | null
          origin_lng?: number | null
          query?: string | null
          radius_miles?: number | null
          section?: string
          user_id?: string
        }
        Relationships: []
      }
      seed_purge_runs: {
        Row: {
          dry_run: boolean
          id: number
          ran_at: string
          result: Json
        }
        Insert: {
          dry_run: boolean
          id?: number
          ran_at?: string
          result: Json
        }
        Update: {
          dry_run?: boolean
          id?: number
          ran_at?: string
          result?: Json
        }
        Relationships: []
      }
      series_date_offers: {
        Row: {
          helper_id: string
          id: string
          offered_at: string
          parent_job_id: string
        }
        Insert: {
          helper_id: string
          id?: string
          offered_at?: string
          parent_job_id: string
        }
        Update: {
          helper_id?: string
          id?: string
          offered_at?: string
          parent_job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "series_date_offers_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "series_date_offers_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "series_date_offers_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      series_platform_ends: {
        Row: {
          admin_id: string | null
          ended_at: string
          end_kind: string
          parent_job_id: string
          reason: string | null
        }
        Insert: {
          admin_id?: string | null
          ended_at?: string
          end_kind: string
          parent_job_id: string
          reason?: string | null
        }
        Update: {
          admin_id?: string | null
          ended_at?: string
          end_kind?: string
          parent_job_id?: string
          reason?: string | null
        }
        Relationships: []
      }
      series_visit_holds: {
        Row: {
          claimed_at: string
          helper_id: string
          id: string
          parent_job_id: string
          visit_date: string
        }
        Insert: {
          claimed_at?: string
          helper_id: string
          id?: string
          parent_job_id: string
          visit_date: string
        }
        Update: {
          claimed_at?: string
          helper_id?: string
          id?: string
          parent_job_id?: string
          visit_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "series_visit_holds_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "series_visit_holds_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "series_visit_holds_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          accepted_at: string | null
          buyer_id: string | null
          attempts: number
          created_at: string
          declutter_order_id: string | null
          delivered_at: string | null
          extra_insurance_cents: number
          id: string
          idempotency_key: string
          is_seed: boolean
          label_cost_cents: number | null
          label_path: string | null
          last_error: string | null
          label_mode: string
          next_attempt_at: string
          parcel: Json
          label_provider: string
          provider_rate_id: string | null
          provider_shipment_id: string | null
          quoted_cents: number
          service: string
          ship_to: Json
          shop_order_id: string | null
          label_state: string
          tracking_code: string | null
          tracking_status: string | null
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          buyer_id?: string | null
          attempts?: number
          created_at?: string
          declutter_order_id?: string | null
          delivered_at?: string | null
          extra_insurance_cents?: number
          id?: string
          idempotency_key: string
          is_seed?: boolean
          label_cost_cents?: number | null
          label_path?: string | null
          last_error?: string | null
          label_mode: string
          next_attempt_at?: string
          parcel: Json
          label_provider?: string
          provider_rate_id?: string | null
          provider_shipment_id?: string | null
          quoted_cents: number
          service: string
          ship_to: Json
          shop_order_id?: string | null
          label_state?: string
          tracking_code?: string | null
          tracking_status?: string | null
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          buyer_id?: string | null
          attempts?: number
          created_at?: string
          declutter_order_id?: string | null
          delivered_at?: string | null
          extra_insurance_cents?: number
          id?: string
          idempotency_key?: string
          is_seed?: boolean
          label_cost_cents?: number | null
          label_path?: string | null
          last_error?: string | null
          label_mode?: string
          next_attempt_at?: string
          parcel?: Json
          label_provider?: string
          provider_rate_id?: string | null
          provider_shipment_id?: string | null
          quoted_cents?: number
          service?: string
          ship_to?: Json
          shop_order_id?: string | null
          label_state?: string
          tracking_code?: string | null
          tracking_status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipments_declutter_order_id_fkey"
            columns: ["declutter_order_id"]
            isOneToOne: false
            referencedRelation: "declutter_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_shop_order_id_fkey"
            columns: ["shop_order_id"]
            isOneToOne: false
            referencedRelation: "shop_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_quotes: {
        Row: {
          buyer_id: string
          cart_item_ids: string[]
          created_at: string
          delivery_days: number | null
          expires_at: string
          id: string
          is_seed: boolean
          label_mode: string
          parcel: Json
          preselected: boolean
          provider_rate_id: string
          provider_shipment_id: string
          rate_cents: number
          seller_id: string
          service: string
          ship_to: Json
        }
        Insert: {
          buyer_id: string
          cart_item_ids: string[]
          created_at?: string
          delivery_days?: number | null
          expires_at?: string
          id?: string
          is_seed?: boolean
          label_mode: string
          parcel: Json
          preselected?: boolean
          provider_rate_id: string
          provider_shipment_id: string
          rate_cents: number
          seller_id: string
          service: string
          ship_to: Json
        }
        Update: {
          buyer_id?: string
          cart_item_ids?: string[]
          created_at?: string
          delivery_days?: number | null
          expires_at?: string
          id?: string
          is_seed?: boolean
          label_mode?: string
          parcel?: Json
          preselected?: boolean
          provider_rate_id?: string
          provider_shipment_id?: string
          rate_cents?: number
          seller_id?: string
          service?: string
          ship_to?: Json
        }
        Relationships: []
      }
      shop_categories: {
        Row: {
          group_label: string
          group_slug: string
          label: string
          position: number
          slug: string
        }
        Insert: {
          group_label: string
          group_slug: string
          label: string
          position: number
          slug: string
        }
        Update: {
          group_label?: string
          group_slug?: string
          label?: string
          position?: number
          slug?: string
        }
        Relationships: []
      }
      shop_cottage_confirmations: {
        Row: {
          confirmed_at: string
          limit_year: number
          owner_id: string
        }
        Insert: {
          confirmed_at?: string
          limit_year: number
          owner_id: string
        }
        Update: {
          confirmed_at?: string
          limit_year?: number
          owner_id?: string
        }
        Relationships: []
      }
      shop_cottage_sales: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          is_seed: boolean
          owner_id: string
          sold_at: string
          source_ref: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          is_seed?: boolean
          owner_id: string
          sold_at?: string
          source_ref: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          is_seed?: boolean
          owner_id?: string
          sold_at?: string
          source_ref?: string
        }
        Relationships: []
      }
      shop_cottage_settings: {
        Row: {
          cap_cents: number
          id: boolean
          note: string
          updated_at: string
          warn_percent: number
        }
        Insert: {
          cap_cents: number
          id?: boolean
          note?: string
          updated_at?: string
          warn_percent?: number
        }
        Update: {
          cap_cents?: number
          id?: boolean
          note?: string
          updated_at?: string
          warn_percent?: number
        }
        Relationships: []
      }
      shop_faqs: {
        Row: {
          answer: string
          created_at: string
          id: string
          position: number
          question: string
          shop_id: string
        }
        Insert: {
          answer: string
          created_at?: string
          id?: string
          position: number
          question: string
          shop_id: string
        }
        Update: {
          answer?: string
          created_at?: string
          id?: string
          position?: number
          question?: string
          shop_id?: string
        }
        Relationships: []
      }
      shop_follows: {
        Row: {
          created_at: string
          shop_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          shop_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          shop_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_follows_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_hand_refunds: {
        Row: {
          amount_cents: number
          created_at: string
          failed_at: string | null
          is_seed: boolean
          livemode: boolean | null
          note: string | null
          order_id: string
          outcome: string
          recorded_by: string | null
          recorded_how: string
          shop_refund_id: string | null
          stripe_payment_intent_id: string
          stripe_refund_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          failed_at?: string | null
          is_seed?: boolean
          livemode?: boolean | null
          note?: string | null
          order_id: string
          outcome: string
          recorded_by?: string | null
          recorded_how: string
          shop_refund_id?: string | null
          stripe_payment_intent_id: string
          stripe_refund_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          failed_at?: string | null
          is_seed?: boolean
          livemode?: boolean | null
          note?: string | null
          order_id?: string
          outcome?: string
          recorded_by?: string | null
          recorded_how?: string
          shop_refund_id?: string | null
          stripe_payment_intent_id?: string
          stripe_refund_id?: string
        }
        Relationships: []
      }
      shop_handovers: {
        Row: {
          confirmed_at: string | null
          confirmed_how: string | null
          created_at: string
          is_seed: boolean
          order_id: string
          problem_at: string | null
          problem_note: string | null
          ready_at: string | null
          ready_photo_path: string | null
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_how?: string | null
          created_at?: string
          is_seed?: boolean
          order_id: string
          problem_at?: string | null
          problem_note?: string | null
          ready_at?: string | null
          ready_photo_path?: string | null
        }
        Update: {
          confirmed_at?: string | null
          confirmed_how?: string | null
          created_at?: string
          is_seed?: boolean
          order_id?: string
          problem_at?: string | null
          problem_note?: string | null
          ready_at?: string | null
          ready_photo_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_handovers_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "shop_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_hours: {
        Row: {
          closes_local: string
          id: string
          opens_local: string
          shop_id: string
          weekday: number
        }
        Insert: {
          closes_local: string
          id?: string
          opens_local: string
          shop_id: string
          weekday: number
        }
        Update: {
          closes_local?: string
          id?: string
          opens_local?: string
          shop_id?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "shop_hours_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_item_attestations: {
        Row: {
          attested_at: string
          item_id: string
          owner_id: string
          statements: string[]
        }
        Insert: {
          attested_at?: string
          item_id: string
          owner_id: string
          statements: string[]
        }
        Update: {
          attested_at?: string
          item_id?: string
          owner_id?: string
          statements?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "shop_item_attestations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "shop_items"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_item_photos: {
        Row: {
          created_at: string
          id: string
          item_id: string
          owner_id: string
          position: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          owner_id: string
          position: number
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          owner_id?: string
          position?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_item_photos_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "shop_items"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_item_private: {
        Row: {
          admin_rejected_at: string | null
          ai_checked_at: string | null
          ai_flag_reason: string | null
          item_id: string
          owner_id: string
          review_note: string | null
          text_flag_reason: string | null
          updated_at: string
        }
        Insert: {
          admin_rejected_at?: string | null
          ai_checked_at?: string | null
          ai_flag_reason?: string | null
          item_id: string
          owner_id: string
          review_note?: string | null
          text_flag_reason?: string | null
          updated_at?: string
        }
        Update: {
          admin_rejected_at?: string | null
          ai_checked_at?: string | null
          ai_flag_reason?: string | null
          item_id?: string
          owner_id?: string
          review_note?: string | null
          text_flag_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_item_private_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "shop_items"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_item_subtypes: {
        Row: {
          kind: string
          label: string
          position: number
          slug: string
        }
        Insert: {
          kind: string
          label: string
          position: number
          slug: string
        }
        Update: {
          kind?: string
          label?: string
          position?: number
          slug?: string
        }
        Relationships: []
      }
      shop_items: {
        Row: {
          admin_approved_at: string | null
          created_at: string
          description: string
          id: string
          is_seed: boolean
          kind: string
          lead_time_days: number
          live_at: string | null
          owner_id: string
          price_cents: number
          shop_id: string
          status: string
          stock_count: number | null
          submitted_at: string | null
          subtype: string
          title: string
          updated_at: string
        }
        Insert: {
          admin_approved_at?: string | null
          created_at?: string
          description?: string
          id?: string
          is_seed?: boolean
          kind: string
          lead_time_days?: number
          live_at?: string | null
          owner_id: string
          price_cents: number
          shop_id: string
          status?: string
          stock_count?: number | null
          submitted_at?: string | null
          subtype: string
          title: string
          updated_at?: string
        }
        Update: {
          admin_approved_at?: string | null
          created_at?: string
          description?: string
          id?: string
          is_seed?: boolean
          kind?: string
          lead_time_days?: number
          live_at?: string | null
          owner_id?: string
          price_cents?: number
          shop_id?: string
          status?: string
          stock_count?: number | null
          submitted_at?: string | null
          subtype?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_items_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_items_subtype_fkey"
            columns: ["subtype"]
            isOneToOne: false
            referencedRelation: "shop_item_subtypes"
            referencedColumns: ["slug"]
          },
        ]
      }
      shop_order_lines: {
        Row: {
          created_at: string
          id: string
          is_seed: boolean
          item_id: string | null
          kind: string
          line_cents: number
          order_id: string
          quantity: number
          title: string
          unit_cents: number
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_seed?: boolean
          item_id?: string | null
          kind: string
          line_cents: number
          order_id: string
          quantity: number
          title: string
          unit_cents: number
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_seed?: boolean
          item_id?: string | null
          kind?: string
          line_cents?: number
          order_id?: string
          quantity?: number
          title?: string
          unit_cents?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_order_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "shop_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "shop_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_orders: {
        Row: {
          accept_by: string | null
          accepted_at: string | null
          buyer_id: string | null
          cancel_policy: string
          capture_attempts: number
          capture_last_attempt_at: string | null
          capture_last_error: string | null
          captured_at: string | null
          card_fee_cents: number | null
          close_reason: string | null
          closed_at: string | null
          created_at: string
          decline_reason: string | null
          handed_over_at: string | null
          handover_mode: string
          held_at: string | null
          hold_release_attempts: number
          hold_release_last_error: string | null
          hold_released_at: string | null
          id: string
          is_seed: boolean
          items_cents: number
          note: string
          payment_livemode: boolean | null
          premium_cents: number
          ready_date: string
          ready_tap_cancel: string
          seller_id: string | null
          shop_id: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          tax_cents: number
          total_cents: number
        }
        Insert: {
          accept_by?: string | null
          accepted_at?: string | null
          buyer_id?: string | null
          cancel_policy: string
          capture_attempts?: number
          capture_last_attempt_at?: string | null
          capture_last_error?: string | null
          captured_at?: string | null
          card_fee_cents?: number | null
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          decline_reason?: string | null
          handed_over_at?: string | null
          handover_mode?: string
          held_at?: string | null
          hold_release_attempts?: number
          hold_release_last_error?: string | null
          hold_released_at?: string | null
          id?: string
          is_seed?: boolean
          items_cents: number
          note?: string
          payment_livemode?: boolean | null
          premium_cents: number
          ready_date: string
          ready_tap_cancel?: string
          seller_id?: string | null
          shop_id?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          tax_cents?: number
          total_cents: number
        }
        Update: {
          accept_by?: string | null
          accepted_at?: string | null
          buyer_id?: string | null
          cancel_policy?: string
          capture_attempts?: number
          capture_last_attempt_at?: string | null
          capture_last_error?: string | null
          captured_at?: string | null
          card_fee_cents?: number | null
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          decline_reason?: string | null
          handed_over_at?: string | null
          handover_mode?: string
          held_at?: string | null
          hold_release_attempts?: number
          hold_release_last_error?: string | null
          hold_released_at?: string | null
          id?: string
          is_seed?: boolean
          items_cents?: number
          note?: string
          payment_livemode?: boolean | null
          premium_cents?: number
          ready_date?: string
          ready_tap_cancel?: string
          seller_id?: string | null
          shop_id?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          tax_cents?: number
          total_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "shop_orders_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_payouts: {
        Row: {
          amount_cents: number
          attempts: number
          created_at: string
          debt_cents: number
          executed_at: string | null
          held_notified_at: string | null
          id: string
          is_seed: boolean
          items_cents: number
          last_error: string | null
          next_attempt_at: string
          order_id: string
          review_held_at: string | null
          review_reason: string | null
          settled_by_hand_cents: number | null
          settled_by_hand_note: string | null
          settled_by_hand_ref: string | null
          status: string
          stripe_transfer_id: string | null
        }
        Insert: {
          amount_cents: number
          attempts?: number
          created_at?: string
          debt_cents: number
          executed_at?: string | null
          held_notified_at?: string | null
          id?: string
          is_seed?: boolean
          items_cents: number
          last_error?: string | null
          next_attempt_at?: string
          order_id: string
          review_held_at?: string | null
          review_reason?: string | null
          settled_by_hand_cents?: number | null
          settled_by_hand_note?: string | null
          settled_by_hand_ref?: string | null
          status: string
          stripe_transfer_id?: string | null
        }
        Update: {
          amount_cents?: number
          attempts?: number
          created_at?: string
          debt_cents?: number
          executed_at?: string | null
          held_notified_at?: string | null
          id?: string
          is_seed?: boolean
          items_cents?: number
          last_error?: string | null
          next_attempt_at?: string
          order_id?: string
          review_held_at?: string | null
          review_reason?: string | null
          settled_by_hand_cents?: number | null
          settled_by_hand_note?: string | null
          settled_by_hand_ref?: string | null
          status?: string
          stripe_transfer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_payouts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "shop_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_photos: {
        Row: {
          created_at: string
          id: string
          photo_kind: string
          owner_id: string
          position: number
          shop_id: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          photo_kind: string
          owner_id: string
          position: number
          shop_id: string
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          photo_kind?: string
          owner_id?: string
          position?: number
          shop_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_photos_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_pickup_addresses: {
        Row: {
          city: string
          created_at: string
          is_seed: boolean
          line1: string
          line2: string | null
          owner_id: string
          postal_code: string
          shop_id: string
          state_code: string
          stripe_tax_location_id: string | null
          stripe_tax_location_mode: string | null
          updated_at: string
        }
        Insert: {
          city: string
          created_at?: string
          is_seed?: boolean
          line1: string
          line2?: string | null
          owner_id: string
          postal_code: string
          shop_id: string
          state_code?: string
          stripe_tax_location_id?: string | null
          stripe_tax_location_mode?: string | null
          updated_at?: string
        }
        Update: {
          city?: string
          created_at?: string
          is_seed?: boolean
          line1?: string
          line2?: string | null
          owner_id?: string
          postal_code?: string
          shop_id?: string
          state_code?: string
          stripe_tax_location_id?: string | null
          stripe_tax_location_mode?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_pickup_addresses_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: true
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_refunds: {
        Row: {
          attempts: number
          card_fee_cents: number
          created_at: string
          executed_at: string | null
          fee_policy: string
          held_notified_at: string | null
          id: string
          is_seed: boolean
          kept_cents: number
          last_error: string | null
          next_attempt_at: string
          note: string | null
          order_id: string
          paid_cents: number
          reason: string
          refund_cents: number
          reversals: number
          review_held_at: string | null
          review_reason: string | null
          settled_by_hand_cents: number | null
          settled_by_hand_note: string | null
          settled_by_hand_ref: string | null
          status: string
          stripe_payment_intent_id: string
          stripe_refund_id: string | null
          tax_cents: number
          tax_kept_cents: number
        }
        Insert: {
          attempts?: number
          card_fee_cents: number
          created_at?: string
          executed_at?: string | null
          fee_policy: string
          held_notified_at?: string | null
          id?: string
          is_seed?: boolean
          kept_cents: number
          last_error?: string | null
          next_attempt_at?: string
          note?: string | null
          order_id: string
          paid_cents: number
          reason: string
          refund_cents: number
          reversals?: number
          review_held_at?: string | null
          review_reason?: string | null
          settled_by_hand_cents?: number | null
          settled_by_hand_note?: string | null
          settled_by_hand_ref?: string | null
          status?: string
          stripe_payment_intent_id: string
          stripe_refund_id?: string | null
          tax_cents: number
          tax_kept_cents: number
        }
        Update: {
          attempts?: number
          card_fee_cents?: number
          created_at?: string
          executed_at?: string | null
          fee_policy?: string
          held_notified_at?: string | null
          id?: string
          is_seed?: boolean
          kept_cents?: number
          last_error?: string | null
          next_attempt_at?: string
          note?: string | null
          order_id?: string
          paid_cents?: number
          reason?: string
          refund_cents?: number
          reversals?: number
          review_held_at?: string | null
          review_reason?: string | null
          settled_by_hand_cents?: number | null
          settled_by_hand_note?: string | null
          settled_by_hand_ref?: string | null
          status?: string
          stripe_payment_intent_id?: string
          stripe_refund_id?: string | null
          tax_cents?: number
          tax_kept_cents?: number
        }
        Relationships: []
      }
      shop_strikes: {
        Row: {
          expires_at: string
          given_at: string
          id: string
          is_seed: boolean
          offender_side: string
          order_id: string | null
          reason: string
          removed_at: string | null
          removed_by: string | null
          removed_note: string | null
          user_id: string
        }
        Insert: {
          expires_at: string
          given_at?: string
          id?: string
          is_seed?: boolean
          offender_side: string
          order_id?: string | null
          reason: string
          removed_at?: string | null
          removed_by?: string | null
          removed_note?: string | null
          user_id: string
        }
        Update: {
          expires_at?: string
          given_at?: string
          id?: string
          is_seed?: boolean
          offender_side?: string
          order_id?: string | null
          reason?: string
          removed_at?: string | null
          removed_by?: string | null
          removed_note?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_strikes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "shop_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      shops: {
        Row: {
          about: string
          area_label: string
          cancel_policy: string
          category: string
          created_at: string
          daily_order_cap: number | null
          handover_mode: string
          hidden_at: string | null
          hidden_by: string | null
          hidden_reason: string | null
          id: string
          is_seed: boolean
          name: string
          offers_quotes: boolean
          offers_selling: boolean
          owner_id: string
          parishes_served: string[]
          paused: boolean
          pin_lat: number
          pin_lng: number
          ready_tap_cancel: string
          sos_number: string | null
          sos_verified_at: string | null
          sos_verified_by: string | null
          storefront: boolean
          updated_at: string
        }
        Insert: {
          about?: string
          area_label: string
          cancel_policy?: string
          category: string
          created_at?: string
          daily_order_cap?: number | null
          handover_mode?: string
          hidden_at?: string | null
          hidden_by?: string | null
          hidden_reason?: string | null
          id?: string
          is_seed?: boolean
          name: string
          offers_quotes?: boolean
          offers_selling?: boolean
          owner_id: string
          parishes_served?: string[]
          paused?: boolean
          pin_lat: number
          pin_lng: number
          ready_tap_cancel?: string
          sos_number?: string | null
          sos_verified_at?: string | null
          sos_verified_by?: string | null
          storefront?: boolean
          updated_at?: string
        }
        Update: {
          about?: string
          area_label?: string
          cancel_policy?: string
          category?: string
          created_at?: string
          daily_order_cap?: number | null
          handover_mode?: string
          hidden_at?: string | null
          hidden_by?: string | null
          hidden_reason?: string | null
          id?: string
          is_seed?: boolean
          name?: string
          offers_quotes?: boolean
          offers_selling?: boolean
          owner_id?: string
          parishes_served?: string[]
          paused?: boolean
          pin_lat?: number
          pin_lng?: number
          ready_tap_cancel?: string
          sos_number?: string | null
          sos_verified_at?: string | null
          sos_verified_by?: string | null
          storefront?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shops_category_fkey"
            columns: ["category"]
            isOneToOne: false
            referencedRelation: "shop_categories"
            referencedColumns: ["slug"]
          },
        ]
      }
      signup_leads: {
        Row: {
          completed_at: string | null
          created_at: string
          email: string
          id: string
          reminder_sent_at: string | null
          source: string | null
          unsubscribed_at: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          email: string
          id?: string
          reminder_sent_at?: string | null
          source?: string | null
          unsubscribed_at?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          email?: string
          id?: string
          reminder_sent_at?: string | null
          source?: string | null
          unsubscribed_at?: string | null
        }
        Relationships: []
      }
      sms_consent: {
        Row: {
          confirm_code: string | null
          confirm_phone: string | null
          confirm_sent_at: string | null
          consent_text_version: string | null
          job_match_texts: boolean
          opt_in_source: string | null
          opt_out_source: string | null
          opted_in_at: string | null
          opted_out_at: string | null
          pending_phone: string | null
          pending_since: string | null
          phone_e164: string | null
          sms_opt_in: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          confirm_code?: string | null
          confirm_phone?: string | null
          confirm_sent_at?: string | null
          consent_text_version?: string | null
          job_match_texts?: boolean
          opt_in_source?: string | null
          opt_out_source?: string | null
          opted_in_at?: string | null
          opted_out_at?: string | null
          pending_phone?: string | null
          pending_since?: string | null
          phone_e164?: string | null
          sms_opt_in?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          confirm_code?: string | null
          confirm_phone?: string | null
          confirm_sent_at?: string | null
          consent_text_version?: string | null
          job_match_texts?: boolean
          opt_in_source?: string | null
          opt_out_source?: string | null
          opted_in_at?: string | null
          opted_out_at?: string | null
          pending_phone?: string | null
          pending_since?: string | null
          phone_e164?: string | null
          sms_opt_in?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sms_consent_events: {
        Row: {
          account_deleted_at: string | null
          consent_text_version: string | null
          created_at: string
          event: string
          id: string
          phone_e164: string
          source: string
          user_id: string | null
        }
        Insert: {
          account_deleted_at?: string | null
          consent_text_version?: string | null
          created_at?: string
          event: string
          id?: string
          phone_e164: string
          source: string
          user_id?: string | null
        }
        Update: {
          account_deleted_at?: string | null
          consent_text_version?: string | null
          created_at?: string
          event?: string
          id?: string
          phone_e164?: string
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      sms_messages: {
        Row: {
          category: string | null
          created_at: string
          due_at: string | null
          id: string
          kind: string | null
          notification_id: string | null
          phone_hash: string | null
          provider_error_code: string | null
          provider_sid: string | null
          reason: string | null
          sent_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          kind?: string | null
          notification_id?: string | null
          phone_hash?: string | null
          provider_error_code?: string | null
          provider_sid?: string | null
          reason?: string | null
          sent_at?: string | null
          status: string
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          kind?: string | null
          notification_id?: string | null
          phone_hash?: string | null
          provider_error_code?: string | null
          provider_sid?: string | null
          reason?: string | null
          sent_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      social_signup_choices: {
        Row: {
          chose_new_at: string | null
          created_at: string
          id: string
          provider_sub: string
          relay: boolean
          social_provider: string
        }
        Insert: {
          chose_new_at?: string | null
          created_at?: string
          id?: string
          provider_sub: string
          relay?: boolean
          social_provider: string
        }
        Update: {
          chose_new_at?: string | null
          created_at?: string
          id?: string
          provider_sub?: string
          relay?: boolean
          social_provider?: string
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
      stripe_customers: {
        Row: {
          created_at: string
          stripe_customer_id: string
          wallet_mode: string
          user_id: string
        }
        Insert: {
          created_at?: string
          stripe_customer_id: string
          wallet_mode: string
          user_id: string
        }
        Update: {
          created_at?: string
          stripe_customer_id?: string
          wallet_mode?: string
          user_id?: string
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
      stuck_payment_stripe_checks: {
        Row: {
          checked_at: string
          job_id: string
          money_moved: boolean
          payment_intent_id: string | null
          payment_status: string
          session_status: string
          stripe_session_id: string
        }
        Insert: {
          checked_at?: string
          job_id: string
          money_moved: boolean
          payment_intent_id?: string | null
          payment_status: string
          session_status: string
          stripe_session_id: string
        }
        Update: {
          checked_at?: string
          job_id?: string
          money_moved?: boolean
          payment_intent_id?: string | null
          payment_status?: string
          session_status?: string
          stripe_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stuck_payment_stripe_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stuck_payment_stripe_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stuck_payment_stripe_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
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
      support_replies: {
        Row: {
          admin_id: string | null
          body: string
          created_at: string
          email_message_id: string | null
          email_skip_reason: string | null
          id: string
          notification_id: string | null
          outcome_recorded: boolean
          report_id: string
          resolved_on_send: boolean
        }
        Insert: {
          admin_id?: string | null
          body: string
          created_at?: string
          email_message_id?: string | null
          email_skip_reason?: string | null
          id?: string
          notification_id?: string | null
          outcome_recorded?: boolean
          report_id: string
          resolved_on_send?: boolean
        }
        Update: {
          admin_id?: string | null
          body?: string
          created_at?: string
          email_message_id?: string | null
          email_skip_reason?: string | null
          id?: string
          notification_id?: string | null
          outcome_recorded?: boolean
          report_id?: string
          resolved_on_send?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "support_replies_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      test_accounts: {
        Row: {
          enrolled_at: string
          note: string | null
          user_id: string
        }
        Insert: {
          enrolled_at?: string
          note?: string | null
          user_id: string
        }
        Update: {
          enrolled_at?: string
          note?: string | null
          user_id?: string
        }
        Relationships: []
      }
      test_fixture_jobs: {
        Row: {
          created_at: string
          job_id: string
          purpose: string
        }
        Insert: {
          created_at?: string
          job_id: string
          purpose: string
        }
        Update: {
          created_at?: string
          job_id?: string
          purpose?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_fixture_jobs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      thread_archives: {
        Row: {
          archived_at: string
          id: string
          job_id: string
          other_user_id: string | null
          user_id: string
        }
        Insert: {
          archived_at?: string
          id?: string
          job_id: string
          other_user_id?: string | null
          user_id: string
        }
        Update: {
          archived_at?: string
          id?: string
          job_id?: string
          other_user_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_archives_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_archives_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_archives_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
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
      thread_pins: {
        Row: {
          job_id: string
          other_user_id: string
          pinned_at: string
          user_id: string
        }
        Insert: {
          job_id: string
          other_user_id: string
          pinned_at?: string
          user_id: string
        }
        Update: {
          job_id?: string
          other_user_id?: string
          pinned_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_pins_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_pins_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_helper_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_pins_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "open_jobs_browse"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_hold_redrives: {
        Row: {
          amount_cents: number
          created_at: string
          failure_reason: string | null
          first_repay_attempt_at: string | null
          helper_id: string
          repay_transfer_id: string | null
          reversal_id: string | null
          status: string
          tip_id: string
          transfer_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          failure_reason?: string | null
          first_repay_attempt_at?: string | null
          helper_id: string
          repay_transfer_id?: string | null
          reversal_id?: string | null
          status?: string
          tip_id: string
          transfer_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          failure_reason?: string | null
          first_repay_attempt_at?: string | null
          helper_id?: string
          repay_transfer_id?: string | null
          reversal_id?: string | null
          status?: string
          tip_id?: string
          transfer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tip_hold_redrives_tip_id_fkey"
            columns: ["tip_id"]
            isOneToOne: true
            referencedRelation: "tips"
            referencedColumns: ["id"]
          },
        ]
      }
      tips: {
        Row: {
          amount: number
          auto_prompt_sent_at: string | null
          created_at: string
          failure_reason: string | null
          helper_id: string
          id: string
          job_id: string
          payment_status: string
          source: string
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          tipper_id: string
        }
        Insert: {
          amount: number
          auto_prompt_sent_at?: string | null
          created_at?: string
          failure_reason?: string | null
          helper_id: string
          id?: string
          job_id: string
          payment_status?: string
          source?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          tipper_id: string
        }
        Update: {
          amount?: number
          auto_prompt_sent_at?: string | null
          created_at?: string
          failure_reason?: string | null
          helper_id?: string
          id?: string
          job_id?: string
          payment_status?: string
          source?: string
          stripe_payment_intent_id?: string | null
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
    }
    Views: {
      analytics_events_real: {
        Row: {
          created_at: string | null
          event: string | null
          id: string | null
          platform: string | null
          properties: Json | null
          referrer: string | null
          url: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          event?: string | null
          id?: string | null
          platform?: string | null
          properties?: Json | null
          referrer?: string | null
          url?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          event?: string | null
          id?: string | null
          platform?: string | null
          properties?: Json | null
          referrer?: string | null
          url?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
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
          credential_tier: number | null
          crew_spots_open: number | null
          customer_id: string | null
          date_needed: string | null
          description: string | null
          direct_offer_expires_at: string | null
          direct_offer_status: string | null
          estimated_hours: number | null
          expires_at: string | null
          helper_fee_flat_cents: number | null
          helper_fee_percent: number | null
          helpers_needed: number | null
          id: string | null
          is_flexible_schedule: boolean | null
          is_group_job: boolean | null
          is_recurring: boolean | null
          is_urgent: boolean | null
          latitude: number | null
          location: string | null
          longitude: number | null
          materials_note: string | null
          offered_to_helper_id: string | null
          parent_job_id: string | null
          parish: string | null
          payment_status: string | null
          photos: string[] | null
          pricing_mode: string | null
          recurrence_days: number[] | null
          recurrence_end_date: string | null
          recurrence_interval: string | null
          recurrence_weeks: number | null
          require_photo_proof: boolean | null
          scope_video_url: string | null
          series_split_ok: boolean | null
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
          credential_tier?: number | null
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
          latitude?: never
          location?: never
          longitude?: never
          materials_note?: string | null
          offered_to_helper_id?: never
          parent_job_id?: string | null
          parish?: string | null
          payment_status?: string | null
          photos?: string[] | null
          pricing_mode?: string | null
          recurrence_days?: number[] | null
          recurrence_end_date?: string | null
          recurrence_interval?: string | null
          recurrence_weeks?: number | null
          require_photo_proof?: boolean | null
          scope_video_url?: string | null
          series_split_ok?: boolean | null
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
          credential_tier?: number | null
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
          latitude?: never
          location?: never
          longitude?: never
          materials_note?: string | null
          offered_to_helper_id?: never
          parent_job_id?: string | null
          parish?: string | null
          payment_status?: string | null
          photos?: string[] | null
          pricing_mode?: string | null
          recurrence_days?: number[] | null
          recurrence_end_date?: string | null
          recurrence_interval?: string | null
          recurrence_weeks?: number | null
          require_photo_proof?: boolean | null
          scope_video_url?: string | null
          series_split_ok?: boolean | null
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
      accept_application_at_suggested_time: {
        Args: {
          p_application_id: string
          p_deadline: string
          p_offer_message?: string
        }
        Returns: undefined
      }
      accept_group_application: {
        Args: {
          p_application_id: string
          p_deadline?: string
          p_offer_message?: string
        }
        Returns: {
          roster_complete: boolean
          slots_filled: number
          slots_total: number
        }[]
      }
      accept_job_offer: { Args: { p_job_id: string }; Returns: Json }
      ack_backout_notice: {
        Args: { p_id: string }
        Returns: undefined
      }
      admin_approval_escalation_queue: {
        Args: { p_include_resolved?: boolean }
        Returns: {
          budget: number
          customer_id: string
          escalated_at: string
          helper_completed_at: string
          helper_id: string
          is_group_job: boolean
          job_id: string
          payment_status: string
          reason: string
          resolution: string
          resolved_at: string
          revision_completed_at: string
          status: string
          still_waiting: boolean
          title: string
        }[]
      }
      admin_declutter_save_donation_partner: {
        Args: {
          p_active: boolean
          p_address: string
          p_id: string
          p_lat: number
          p_lng: number
          p_name: string
          p_parish: string
          p_takes: string
        }
        Returns: string
      }
      admin_declutter_save_meetup_spot: {
        Args: { p_active: boolean; p_address: string; p_id: string; p_kind: string; p_lat: number; p_lng: number; p_name: string; p_note: string; p_parish: string }
        Returns: string
      }
      admin_idv_request_reupload: {
        Args: { p_note: string; p_user_id: string }
        Returns: number
      }
      admin_section_funnel: {
        Args: { p_days?: number; p_parish?: string; p_section?: string }
        Returns: Json
      }
      admin_alert_close_rule: { Args: { p_title: string }; Returns: string }
      admin_alert_manual_close: { Args: { p_title: string }; Returns: boolean }
      admin_alert_ref: { Args: { p_sample_ref: Json }; Returns: Json }
      admin_alert_subjects: {
        Args: { p_ref: Json; p_rule: string; p_since: string }
        Returns: {
          alerted_at: string
          job_id: string
          user_id: string
        }[]
      }
      admin_apply_account_action: {
        Args: {
          p_action: string
          p_admin_id: string
          p_reason: string
          p_record_strike?: boolean
          p_suspended_until?: string
          p_user_id: string
        }
        Returns: Json
      }
      admin_ban_settlement_reviews: { Args: never; Returns: Json }
      admin_booking_sources: {
        Args: never
        Returns: {
          helpr_id: string
          helpr_name: string
          last_at: string
          posters_brought: number
          posters_who_posted: number
        }[]
      }
      admin_confirm_ban_settlement: {
        Args: { p_user_id: string }
        Returns: Json
      }
      admin_delete_review: {
        Args: { _reason: string; _review_id: string }
        Returns: undefined
      }
      admin_deny_payout_hold: {
        Args: { p_helper_id: string; p_reason: string }
        Returns: {
          denied_at: string | null
          denied_by: string | null
          denied_reason: string | null
          held_at: string
          held_by: string | null
          helper_id: string
          reason: string
        }
        SetofOptions: {
          from: "*"
          to: "payout_holds"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_gift_card_paid_job_ids: {
        Args: never
        Returns: {
          job_id: string
        }[]
      }
      admin_last_activity: {
        Args: never
        Returns: {
          last_applied_at: string
          last_posted_at: string
          user_id: string
        }[]
      }
      admin_last_logins: {
        Args: never
        Returns: {
          last_login_at: string
          user_id: string
        }[]
      }
      admin_list_category_suggestions: {
        Args: { p_status?: string }
        Returns: {
          admin_note: string
          area: string
          created_at: string
          id: string
          reviewed_at: string
          same_count: number
          status: string
          suggester_name: string
          suggestion: string
        }[]
      }
      admin_list_feature_switches: {
        Args: never
        Returns: {
          audience: string
          created_at: string
          description: string
          key: string
          updated_at: string
        }[]
      }
      admin_list_signup_leads: {
        Args: never
        Returns: {
          completed_at: string
          created_at: string
          email: string
          reminder_sent_at: string
          total_count: number
        }[]
      }
      admin_notification_crosses_seed_boundary: {
        Args: { p_job_id: string; p_link: string; p_recipient: string }
        Returns: boolean
      }
      admin_queue_still_pending: {
        Args: { p_ref: Json; p_rule: string; p_since: string }
        Returns: boolean
      }
      admin_release_job_payout_hold: {
        Args: { p_job_id: string }
        Returns: boolean
      }
      admin_release_payout_hold: {
        Args: { p_helper_id: string }
        Returns: boolean
      }
      admin_resolve_ban_evasion_match: {
        Args: { p_match_id: string }
        Returns: boolean
      }
      admin_reverse_violation: {
        Args: {
          p_reason: string
          p_restore_access?: boolean
          p_violation_id: string
        }
        Returns: Json
      }
      admin_review_category_suggestion: {
        Args: { p_approve: boolean; p_id: string; p_note?: string }
        Returns: number
      }
      admin_rule_helpr_fault: {
        Args: {
          p_helper_id: string
          p_job_id: string
          p_kind: string
          p_note: string
        }
        Returns: Json
      }
      admin_send_team_message: {
        Args: { p_client_id?: string; p_content: string; p_user_id: string }
        Returns: {
          attachment_duration: number | null
          attachment_mime: string | null
          attachment_size: number | null
          attachment_url: string | null
          client_id: string | null
          content: string
          created_at: string
          edited_at: string | null
          flag_reason: string | null
          flagged_hidden: boolean
          id: string
          is_system: boolean
          job_id: string | null
          read: boolean
          read_at: string | null
          receiver_id: string | null
          reply_to_id: string | null
          sender_id: string
          team_thread_user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_feature_switch: {
        Args: { p_audience: string; p_key: string }
        Returns: string
      }
      admin_payout_release: {
        Args: { p_confirm_no_transfer: boolean; p_id: string; p_kind: string; p_note: string }
        Returns: Json
      }
      admin_payout_settle_by_hand: {
        Args: { p_amount_cents: number; p_id: string; p_kind: string; p_note: string; p_ref: string }
        Returns: Json
      }
      admin_payouts_held_for_review: { Args: never; Returns: Json }
      admin_set_payout_hold: {
        Args: { p_helper_id: string; p_reason: string }
        Returns: {
          denied_at: string | null
          denied_by: string | null
          denied_reason: string | null
          held_at: string
          held_by: string | null
          helper_id: string
          reason: string
        }
        SetofOptions: {
          from: "*"
          to: "payout_holds"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_signup_source_report: {
        Args: { p_days?: number }
        Returns: {
          campaign: string
          first_posts: number
          signups: number
          source: string
        }[]
      }
      admin_sms_status: { Args: never; Returns: Json }
      admin_stalled_job_queue: {
        Args: { p_include_resolved?: boolean }
        Returns: {
          budget: number
          customer_id: string
          date_needed: string
          escalated_at: string
          estimated_hours: number
          first_sent_at: string
          helper_id: string
          job_id: string
          payment_status: string
          resolved_at: string
          second_sent_at: string
          start_time: string
          status: string
          title: string
        }[]
      }
      admin_support_queue: {
        Args: {
          p_head_start_minutes?: number
          p_priority_tiers?: string[]
          p_status?: string
        }
        Returns: {
          created_at: string
          description: string
          id: string
          priority_at: string
          priority_support: boolean
          reason: string
          reporter_email: string
          reporter_id: string
          reporter_name: string
          status: string
          support_tier: string
        }[]
      }
      admin_support_replies: {
        Args: { p_report_ids: string[] }
        Returns: {
          admin_name: string | null
          body: string
          created_at: string
          email_status: string
          id: string
          notified: boolean
          outcome_recorded: boolean
          report_id: string
          resolved_on_send: boolean
        }[]
      }
      application_cap: { Args: { p_kind: string }; Returns: number }
      application_email_should_wait: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      apply_cancellation_violation_consequence: {
        Args: { p_job_id: string }
        Returns: Json
      }
      apply_consequence_ladder: {
        Args: {
          p_admin_message_format: string
          p_ban_reason: string
          p_clamp_to_worse_status: boolean
          p_copy: Json
          p_description: string
          p_effects: string[]
          p_job_id: string
          p_permanent_requires_review: boolean
          p_prior_count: number
          p_rungs: string[]
          p_suspension_days: number
          p_user: string
          p_violation_type: string
        }
        Returns: Json
      }
      apply_job_denial_consequence: {
        Args: { p_description: string; p_helper: string; p_job: string }
        Returns: Json
      }
      apply_low_rating_flag: { Args: { p_reviewee_id: string }; Returns: Json }
      apply_message_violation_consequence: {
        Args: { p_content: string; p_description: string }
        Returns: Json
      }
      apply_to_job: {
        Args: { p_job_id: string; p_message: string }
        Returns: string
      }
      apply_to_job_with_time: {
        Args: {
          p_job_id: string
          p_message: string
          p_suggested_date: string
          p_suggested_time: string
        }
        Returns: string
      }
      are_safe_media_urls: { Args: { vs: string[] }; Returns: boolean }
      are_users_blocked: {
        Args: { _user_a: string; _user_b: string }
        Returns: boolean
      }
      attach_unconfirmed_email_gate: { Args: never; Returns: number }
      auto_start_due_jobs: { Args: never; Returns: number }
      auto_tip_candidates: {
        Args: { _since_hours?: number }
        Returns: {
          budget: number
          customer_id: string
          helper_id: string
          job_id: string
          tip_amount: number
          tip_state: string
        }[]
      }
      auto_tip_job_state: { Args: { p_job_id: string }; Returns: string }
      backout_notice_applies: {
        Args: { p_job_status: string; p_kind: string }
        Returns: boolean
      }
      backout_notice_text: {
        Args: { p_actor: string; p_kind: string; p_title: string }
        Returns: {
          message: string
          title: string
        }[]
      }
      ban_fingerprint: {
        Args: { p_domain: string; p_value: string }
        Returns: string
      }
      ban_fingerprint_salt: { Args: never; Returns: string }
      ban_review_retained_floor: {
        Args: { p_since: string; p_user_id: string }
        Returns: Json
      }
      ban_review_standing_rung: {
        Args: { p_review_id: string; p_skip_spent: boolean }
        Returns: Json
      }
      ban_standing_rank: { Args: { p_status: string }; Returns: number }
      ban_settlement_action: {
        Args: {
          p_is_crew: boolean
          p_is_series: boolean
          p_payment_status: string
          p_seat: string
          p_status: string
          p_work_started: boolean
        }
        Returns: string
      }
      bill_helpr_fault_card_fee: {
        Args: {
          p_card_fee_cents: number
          p_job_id: string
          p_refund_ref: string
        }
        Returns: number
      }
      block_user_and_settle: {
        Args: { p_blocked: string; p_reason?: string }
        Returns: Json
      }
      book_accepted_quote: {
        Args: { p_request_id: string }
        Returns: string
      }
      can_message_in_job: {
        Args: { _job_id: string; _sender: string }
        Returns: boolean
      }
      can_read_job_access_notes: { Args: { _job_id: string }; Returns: boolean }
      can_read_job_detail_change: {
        Args: { _request_id: string }
        Returns: boolean
      }
      can_review_job: {
        Args: { _job_id: string; _reviewer_id: string }
        Returns: boolean
      }
      can_send_message_in_job: { Args: { _job_id: string }; Returns: boolean }
      can_send_message_to_in_job: {
        Args: { _job_id: string; _receiver: string }
        Returns: boolean
      }
      cancel_job_after_failed_bank_payment: {
        Args: {
          p_gift_card_id?: string
          p_job_id: string
          p_payment_intent_id: string
        }
        Returns: Json
      }
      cancel_quote_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      cancellation_fee_percent: {
        Args: { p_has_helper: boolean; p_hours_until: number }
        Returns: number
      }
      check_browse_view_definer: { Args: never; Returns: Json }
      check_db_saturation: {
        Args: { p_log_timeouts?: number; p_log_window_minutes?: number }
        Returns: Json
      }
      check_dispute_velocity: { Args: { p_user_id: string }; Returns: boolean }
      check_error_log_throttle: { Args: never; Returns: Json }
      check_ops_alert_pending: { Args: never; Returns: Json }
      check_ops_digest_delivery: { Args: never; Returns: Json }
      check_push_token_health: { Args: never; Returns: Json }
      check_seed_boundary_failures: { Args: never; Returns: Json }
      check_stale_dispute_settlement_claims: { Args: never; Returns: Json }
      check_user_reports_reach_ledger: { Args: never; Returns: number }
      claim_confirm_reminders: {
        Args: { p_limit: number; p_step: number }
        Returns: {
          email: string
          full_name: string
          user_id: string
        }[]
      }
      clear_my_job_post_draft: { Args: never; Returns: undefined }
      client_compat_floor: { Args: never; Returns: number }
      close_moot_backout_notices: { Args: { p_job?: string }; Returns: number }
      declutter_add_handover: {
        Args: { p_item_id: string; p_way: string }
        Returns: string[]
      }
      declutter_approve_listed_for_me: {
        Args: {
          p_bought_for_personal_use: boolean
          p_item_ids: string[]
          p_keeps_item_until_handover: boolean
          p_not_a_frequent_seller: boolean
          p_not_in_the_business: boolean
        }
        Returns: Json
      }
      declutter_decline_listed_for_me: {
        Args: {
          p_item_id: string
        }
        Returns: undefined
      }
      declutter_delivery_still_in_hand: {
        Args: { p_order_id: string; p_task: string }
        Returns: Json
      }
      declutter_handover_refused: {
        Args: { p_handover: string; p_lines: string[] }
        Returns: boolean
      }
      declutter_hold_length: {
        Args: { p_price: number; p_source: string }
        Returns: unknown
      }
      declutter_hold_unchecked_listings: { Args: never; Returns: number }
      declutter_helpr_add_listing_photo: {
        Args: {
          p_item_id: string
          p_storage_path: string
        }
        Returns: string
      }
      declutter_helpr_create_listing: {
        Args: {
          p_area_label: string
          p_category: string
          p_condition_stars: number
          p_delivery_size: string
          p_description: string
          p_floor_price_cents: number
          p_job_id: string
          p_price_cents: number
          p_title: string
        }
        Returns: string
      }
      declutter_helpr_delete_listing: {
        Args: {
          p_item_id: string
        }
        Returns: undefined
      }
      declutter_helpr_job_listings: {
        Args: {
          p_job_id: string
        }
        Returns: {
          area_label: string
          category: string
          condition_stars: number
          delivery_size: string
          description: string
          floor_price_cents: number
          item_id: string
          photo_count: number
          price_cents: number
          sent_at: string
          status: string
          title: string
        }[]
      }
      declutter_helpr_remove_listing_photo: {
        Args: {
          p_photo_id: string
        }
        Returns: undefined
      }
      declutter_helpr_send_listings: {
        Args: {
          p_job_id: string
        }
        Returns: number
      }
      declutter_helpr_update_listing: {
        Args: {
          p_category: string
          p_condition_stars: number
          p_delivery_size: string
          p_description: string
          p_floor_price_cents: number
          p_item_id: string
          p_price_cents: number
          p_title: string
        }
        Returns: undefined
      }
      declutter_item_link_visible: {
        Args: { p_item_id: string }
        Returns: boolean
      }
      declutter_item_pickup_windows: {
        Args: { p_item_id: string }
        Returns: { ends: string; starts: string; weekday: number }[]
      }
      declutter_list_for_seller_draft: {
        Args: { p_item_id: string }
        Returns: Database["public"]["Tables"]["declutter_items"]["Row"]
      }
      declutter_list_for_seller_job: {
        Args: { p_job_id: string }
        Returns: string
      }
      declutter_listed_for_me: {
        Args: never
        Returns: {
          helpr_first_name: string
          floor_price_cents: number
          item_id: string
          job_id: string
          price_cents: number
          sent_at: string
          title: string
        }[]
      }
      declutter_open_handover_talk: {
        Args: { p_other: string }
        Returns: string
      }
      declutter_order_pickup_windows: {
        Args: { p_order_id: string }
        Returns: {
          ends: string
          latest_pickup_at: string
          starts: string
          weekday: number
        }[]
      }
      declutter_order_talk_until: { Args: { p_order_id: string }; Returns: string }
      declutter_order_talk_view: { Args: { p_order_id: string }; Returns: Json }
      helpr_task_talk_view: { Args: { p_task_id: string }; Returns: Json }
      helpr_task_send_message: {
        Args: { p_task_id: string; p_body: string }
        Returns: string
      }
      declutter_public_item_card: { Args: { p_item_id: string }; Returns: Json }
      declutter_order_slot_in_windows: {
        Args: { p_order_id: string; p_seller: string; p_start: string }
        Returns: boolean
      }
      declutter_pair_needs_talk: {
        Args: { p_buyer: string; p_seller: string }
        Returns: boolean
      }
      declutter_pair_shared_ways: {
        Args: { p_buyer: string; p_seller: string }
        Returns: string[]
      }
      declutter_pair_talking: {
        Args: { p_buyer: string; p_seller: string }
        Returns: boolean
      }
      declutter_place_windows_fill: {
        Args: { p_days: number[]; p_seller: string; p_windows: Json }
        Returns: Json
      }
      declutter_place_windows_valid: {
        Args: { p_windows: Json }
        Returns: boolean
      }
      declutter_public_photo_path: {
        Args: { p_photo_id: string }
        Returns: string
      }
      declutter_active_strike_count: { Args: { p_user_id: string }; Returns: number }
      create_quote_request: {
        Args: {
          p_category: string
          p_date_needed: string
          p_description: string
          p_estimated_hours?: number
          p_latitude?: number
          p_location?: string
          p_longitude?: number
          p_parish?: string
          p_start_time?: string
          p_title: string
          p_window_hours?: number
        }
        Returns: string
      }
      declutter_add_item_photo: {
        Args: { p_item_id: string; p_storage_path: string }
        Returns: string
      }
      declutter_add_wanted_photo: {
        Args: { p_storage_path: string; p_wanted_id: string }
        Returns: number
      }
      declutter_address_access: {
        Args: { p_item_id: string; p_user_id: string }
        Returns: string
      }
      declutter_admin_apply_seller_fault: {
        Args: { p_include_committed?: boolean; p_refund_id: string }
        Returns: number
      }
      declutter_admin_decide_delivery_damage: { Args: { p_note: string; p_problem_id: string }; Returns: Json }
      declutter_admin_problem_case: {
        Args: { p_problem_id: string }
        Returns: {
          handover: string
          helpr_accepted_at: string
          helpr_delivered_at: string
          helpr_dropoff_distance_m: number
          helpr_dropoff_photo_path: string
          helpr_has_delivery_strike: boolean
          helpr_picked_up_at: string
          helpr_pickup_photo_path: string
          order_status: string
          pickup_day: string
          seller_delivered_at: string
          seller_delivery_slot_start: string
          seller_delivery_status: string
          slot_start: string
        }[]
      }
      declutter_admin_problem_talk: {
        Args: { p_problem_id: string }
        Returns: {
          answer: string
          answered_at: string
          body: string
          kind: string
          removed: boolean
          said_at: string
          side: string
        }[]
      }
      declutter_admin_open_problems: {
        Args: { p_include_test?: boolean }
        Returns: {
          bundle_discount_cents: number
          buyer_id: string
          buyer_name: string
          confirmed_at: string
          confirmed_by: string
          delivery_cents: number
          handover: string
          helpr_delivery: boolean
          item_photo_paths: string[]
          item_titles: string[]
          items_cents: number
          note: string
          order_id: string
          order_status: string
          other_side_note: string
          other_side_photo_paths: string[]
          paid_at: string
          picked_up_at: string
          picked_up_distance_m: number
          picked_up_photo_path: string
          premium_cents: number
          problem_id: string
          problem_photo_paths: string[]
          reason: string
          refund_offer_cents: number
          reported_at: string
          reporter_side: string
          seller_id: string
          seller_name: string
          set_out_at: string
          set_out_photo_path: string
          tax_cents: number
          total_cents: number
        }[]
      }
      declutter_admin_decide_problem: {
        Args: {
          p_decision: string
          p_false_report?: boolean
          p_fault: string
          p_note: string
          p_part_cents?: number
          p_problem_id: string
          p_strike: boolean
        }
        Returns: Json
      }
      declutter_admin_pending_items: {
        Args: { p_include_test?: boolean }
        Returns: {
          ai_checked_at: string
          ai_flag_reason: string
          approved_listings: number
          area_label: string
          category: string
          condition_stars: number
          delivery_size: string
          description: string
          item_id: string
          photo_paths: string[]
          price_cents: number
          seller_id: string
          submitted_at: string
          title: string
        }[]
      }
      declutter_admin_reported_items: {
        Args: { p_item_ids: string[] }
        Returns: { is_seed: boolean; item_id: string; seller_id: string; status: string; title: string }[]
      }
      declutter_admin_review_item: {
        Args: { p_approve: boolean; p_item_id: string; p_note: string }
        Returns: string
      }
      declutter_admin_take_down_item: {
        Args: { p_item_id: string; p_note: string; p_report_id?: string }
        Returns: string
      }
      declutter_alert_overdue_checks: { Args: never; Returns: number }
      declutter_answer_refund: {
        Args: { p_answer: string; p_offer_cents: number; p_request_id: string }
        Returns: Json
      }
      declutter_answer_refund_offer: {
        Args: { p_accept: boolean; p_request_id: string }
        Returns: Json
      }
      declutter_answer_delivery_time: { Args: { p_accept: boolean; p_order_id: string }; Returns: Json }
      declutter_apply_seller_fault: {
        Args: { p_include_committed?: boolean; p_refund_id: string }
        Returns: number
      }
      declutter_area_label_problem: {
        Args: { p_area: string; p_pickup_address: string }
        Returns: string
      }
      declutter_answer_question: {
        Args: { p_answer: string; p_question_id: string }
        Returns: string
      }
      declutter_ask_question: {
        Args: { p_item_id: string; p_question: string }
        Returns: string
      }
      declutter_ask_refund: {
        Args: {
          p_note: string
          p_order_id: string
          p_photo_paths?: string[]
          p_reason: string
        }
        Returns: Json
      }
      declutter_assert_can_draft_from_photos: { Args: never; Returns: undefined }
      declutter_assert_can_scan_room: { Args: never; Returns: undefined }
      declutter_assert_member: { Args: { p_selling: boolean }; Returns: string }
      declutter_auto_free_due: { Args: never; Returns: number }
      declutter_auto_free_days_state: {
        Args: { p_item_id: string }
        Returns: number
      }
      declutter_auto_free_state: { Args: { p_item_id: string }; Returns: boolean }
      declutter_attach_checkout_session: {
        Args: { p_order_id: string; p_session_id: string }
        Returns: undefined
      }
      declutter_attest_item: {
        Args: {
          p_bought_for_personal_use: boolean
          p_item_id: string
          p_keeps_item_until_handover: boolean
          p_not_a_frequent_seller: boolean
          p_not_in_the_business: boolean
        }
        Returns: string
      }
      declutter_book_pickup: { Args: { p_order_id: string; p_slot_start: string }; Returns: Json }
      declutter_book_porch_day: {
        Args: { p_day: string; p_order_id: string }
        Returns: Json
      }
      declutter_bundle_applies: {
        Args: { p_item_ids: string[] }
        Returns: string[]
      }
      declutter_bundle_preview: {
        Args: { p_seller_id: string }
        Returns: number
      }
      declutter_bundle_rule: {
        Args: { p_seller_id: string }
        Returns: number
      }
      declutter_bundle_sellers: {
        Args: { p_seller_ids: string[] }
        Returns: string[]
      }
      declutter_bundle_targets: {
        Args: { p_lines: string[]; p_seller_id: string }
        Returns: {
          base_cents: number
          line_id: string
          target_cents: number
        }[]
      }
      declutter_buy_now: {
        Args: { p_expected_price_cents: number; p_item_id: string }
        Returns: string
      }
      declutter_buyer_fee_cents: { Args: { p_items_cents: number }; Returns: number }
      declutter_buyer_cancel_delivery: { Args: { p_order_id: string }; Returns: Json }
      declutter_buyer_fee_cents_seller_delivery: { Args: { p_delivery_cents: number; p_items_cents: number }; Returns: number }
      declutter_buyer_fee_cents_ship: {
        Args: { p_items_cents: number; p_shipping_cents: number }
        Returns: number
      }
      declutter_check_sweep_claim: {
        Args: { p_limit?: number }
        Returns: { sweep_attempt: number; sweep_item_id: string; sweep_seller_id: string }[]
      }
      declutter_check_sweep_give_back: { Args: { p_item_id: string }; Returns: number }
      declutter_checkout_free: { Args: { p_handover: string; p_seller_id: string }; Returns: string }
      declutter_choose_donation: {
        Args: { p_item_ids: string[]; p_partner_id: string }
        Returns: number
      }
      declutter_claim_free: { Args: { p_item_id: string }; Returns: string }
      declutter_request_free: { Args: { p_item_id: string }; Returns: string }
      declutter_stop_my_seller_delivery: { Args: never; Returns: number }
      declutter_withdraw_free_request: { Args: { p_request_id: string }; Returns: undefined }
      declutter_free_claim_gate: { Args: { p_member: string }; Returns: undefined }
      declutter_free_requests_for_item: {
        Args: { p_item_id: string }
        Returns: {
          avg_rating: number
          created_at: string
          display_name: string
          request_id: string
          requester_id: string
          review_count: number
        }[]
      }
      declutter_pick_free_request: { Args: { p_request_id: string }; Returns: string }
      declutter_my_free_pause: { Args: never; Returns: string }
      declutter_open_to_guests: { Args: never; Returns: boolean }
      declutter_cancel_after_no_helpr: { Args: { p_order_id: string }; Returns: Json }
      declutter_cancel_haul_away: {
        Args: { p_item_id: string; p_job_id?: string }
        Returns: string
      }
      declutter_cancelled_sale_session: { Args: { p_item_id: string; p_seller: string }; Returns: string }
      declutter_card_fee_estimate: { Args: { p_amount_cents: number }; Returns: number }
      declutter_close_paid_order: {
        Args: {
          p_order_id: string
          p_reason: string
          p_strike_reason: string
          p_strike_side: string
          p_why: string
        }
        Returns: Json
      }
      declutter_close_wanted: { Args: { p_wanted_id: string }; Returns: string }
      declutter_dropped_into_budget: {
        Args: { p_max_budget: number; p_since: string }
        Returns: string[]
      }
      declutter_donation_own_items: {
        Args: { p_item_ids: string[]; p_uid: string }
        Returns: string[]
      }
      declutter_donation_partner_miles: {
        Args: { p_item_ids: string[]; p_partner_id: string }
        Returns: number
      }
      declutter_donation_partners_near: {
        Args: { p_item_ids: string[] }
        Returns: {
          address: string
          chosen: boolean
          id: string
          miles: number
          name: string
          parish: string
          takes: string
        }[]
      }
      declutter_donation_rules: { Args: never; Returns: Json }
      declutter_free_rules: { Args: never; Returns: Json }
      declutter_record_wanted_ai_check: {
        Args: {
          p_flag_reason: string
          p_judged_paths: string[]
          p_user_id: string
          p_wanted_id: string
        }
        Returns: string
      }
      declutter_wanted_hold_photos: {
        Args: { p_paths: string[]; p_reason: string; p_wanted_id: string }
        Returns: undefined
      }
      declutter_edit_listing: {
        Args: {
          p_bought_for_personal_use: boolean
          p_category: string
          p_condition_stars: number
          p_delivery_size: string
          p_description: string
          p_handovers: string[]
          p_item_id: string
          p_keeps_item_until_handover: boolean
          p_not_a_frequent_seller: boolean
          p_not_in_the_business: boolean
          p_title: string
        }
        Returns: string
      }
      declutter_complete_handover: { Args: { p_by: string; p_order_id: string }; Returns: Json }
      declutter_confirm_handover: {
        Args: { p_code: string; p_method: string; p_order_id: string }
        Returns: Json
      }
      declutter_consume_fee_debt: {
        Args: { p_max_cents: number; p_payout_ref: string; p_seller: string }
        Returns: number
      }
      declutter_create_item: {
        Args: {
          p_area_label: string
          p_category: string
          p_condition_stars: number
          p_delivery_size: string
          p_description: string
          p_floor_price_cents: number
          p_pickup_address: string
          p_pickup_lat: number
          p_pickup_lng: number
          p_price_cents: number
          p_title: string
        }
        Returns: string
      }
      declutter_create_item_with_id: {
        Args: {
          p_area_label: string
          p_category: string
          p_condition_stars: number
          p_delivery_size: string
          p_description: string
          p_floor_price_cents: number
          p_item_id: string
          p_pickup_address: string
          p_pickup_lat: number
          p_pickup_lng: number
          p_price_cents: number
          p_title: string
        }
        Returns: string
      }
      declutter_create_move_drafts: {
        Args: {
          p_area_label: string
          p_items: Json
          p_move_out_on: string
          p_pickup_address: string
          p_pickup_lat: number
          p_pickup_lng: number
        }
        Returns: string[]
      }
      declutter_create_wanted: {
        Args: {
          p_category: string
          p_lat: number
          p_lng: number
          p_max_price_cents: number
          p_public?: boolean
          p_radius_miles: number
          p_what: string
        }
        Returns: string
      }
      declutter_deadline_sweep: { Args: never; Returns: Json }
      declutter_delivery_compute: { Args: { p_buyer: string; p_lines: string[]; p_seller: string }; Returns: unknown }
      declutter_delivery_on_task_event: { Args: { p_by: string; p_event: string; p_order_id: string; p_task: string }; Returns: Json }
      declutter_delivery_open_slots: { Args: { p_except_order: string; p_seller: string }; Returns: string[] }
      declutter_delivery_open_times: { Args: { p_order_id: string }; Returns: Json }
      declutter_delivery_price_cents: { Args: { p_miles: number; p_sizes: string[] }; Returns: number }
      declutter_delivery_quote: { Args: { p_seller_id: string }; Returns: Json }
      declutter_delivery_raise_attach: { Args: { p_raise_id: string; p_session_id: string }; Returns: undefined }
      declutter_delivery_raise_card_fee_cents: { Args: { p_raise_cents: number }; Returns: number }
      declutter_delivery_raise_hand_refund: {
        Args: { p_amount_cents: number; p_payment_intent_id: string; p_stripe_refund_id: string }
        Returns: string
      }
      declutter_delivery_raise_open: { Args: { p_minutes: number; p_order: unknown; p_task: unknown }; Returns: boolean }
      declutter_delivery_raise_paid: {
        Args: {
          p_amount_cents: number
          p_livemode: boolean
          p_order_id: string
          p_payment_intent_id: string
          p_raise_id: string
          p_session_id: string
        }
        Returns: Json
      }
      declutter_delivery_raise_payout_sent: { Args: { p_raise_id: string; p_transfer_id: string }; Returns: string }
      declutter_delivery_raise_refund_defer: { Args: { p_minutes: number; p_raise_id: string }; Returns: undefined }
      declutter_delivery_raise_refund_executed: {
        Args: { p_error: string; p_raise_id: string; p_stripe_refund_id: string; p_succeeded: boolean }
        Returns: string
      }
      declutter_delivery_raise_refund_reversed: { Args: { p_raise_id: string; p_stripe_refund_id: string; p_why: string }; Returns: string }
      declutter_delivery_raise_refunds_due: { Args: { p_limit: number }; Returns: unknown }
      declutter_delivery_raise_rules: { Args: never; Returns: Json }
      declutter_delivery_raise_start: {
        Args: { p_order_id: string; p_raise_cents: number }
        Returns: {
          card_fee_cents: number
          raise_cents: number
          raise_id: string
          superseded_session_id: string
          total_cents: number
        }[]
      }
      declutter_delivery_raise_status: { Args: { p_order_id: string }; Returns: Json }
      declutter_delivery_refund: { Args: { p_order_id: string; p_reason: string }; Returns: string }
      declutter_delivery_refund_executed: { Args: { p_error: string; p_id: string; p_stripe_refund_id: string; p_succeeded: boolean }; Returns: string }
      declutter_delivery_refund_reversed: { Args: { p_id: string; p_stripe_refund_id: string; p_why: string }; Returns: string }
      declutter_delivery_refunds_due: { Args: { p_limit: number }; Returns: unknown }
      declutter_delivery_reserved_cents: { Args: { p_order_id: string }; Returns: number }
      declutter_delivery_slot_ok: { Args: { p_order_id: string; p_start: string }; Returns: boolean }
      declutter_full_refund_cents: { Args: { p_order_id: string }; Returns: number }
      declutter_delivery_slot_starts: { Args: { p_from: string; p_seller: string; p_to: string }; Returns: string[] }
      declutter_delivery_slot_used: { Args: { p_except_order: string; p_seller: string; p_start: string }; Returns: number }
      declutter_delivery_when: { Args: { p_at: string }; Returns: string }
      declutter_give_strike: {
        Args: {
          p_item: string
          p_line?: string
          p_reason: string
          p_side: string
          p_user: string
          p_why: string
        }
        Returns: number
      }
      declutter_guest_seller_first_name: {
        Args: { p_item_id: string }
        Returns: string
      }
      declutter_hand_refund_failed: {
        Args: { p_stripe_refund_id: string; p_why: string }
        Returns: string
      }
      declutter_handover_photo_access: {
        Args: { p_name: string; p_write: boolean }
        Returns: boolean
      }
      declutter_handover_photo_unattached: {
        Args: { p_name: string }
        Returns: boolean
      }
      declutter_handover_sweep: { Args: never; Returns: Json }
      declutter_haul_away_state: {
        Args: { p_item_ids?: string[] }
        Returns: {
          delivery_size: string
          description: string
          eligible_at: string
          item_id: string
          item_status: string
          job_hold: string
          job_id: string
          photo_paths: string[]
          pickup_group: string
          state: string
          title: string
        }[]
      }
      declutter_haul_away_sweep: { Args: never; Returns: Json }
      declutter_haul_away_sweep_candidates: {
        Args: { p_limit: number }
        Returns: {
          item_id: string
        }[]
      }
      declutter_has_agreed_sales: { Args: never; Returns: boolean }
      declutter_haul_job_hold: { Args: { p_job_id: string }; Returns: string }
      declutter_identity_gate: {
        Args: { p_code: string; p_member: string }
        Returns: undefined
      }
      declutter_is_porch_day: { Args: { p_dow: number; p_seller: string }; Returns: boolean }
      declutter_in_agreed_sale: { Args: { p_item_id: string; p_user_id: string }; Returns: boolean }
      declutter_item_address: {
        Args: { p_item_id: string }
        Returns: {
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
        }[]
      }
      declutter_item_questions: {
        Args: { p_item_id: string }
        Returns: {
          answer: string
          answered_at: string
          created_at: string
          id: string
          item_id: string
          question: string
        }[]
      }
      declutter_keep_up_state: { Args: { p_item_id: string }; Returns: boolean }
      declutter_keeps_up: { Args: { p_item_id: string }; Returns: boolean }
      declutter_leave_review: {
        Args: {
          p_comment: string
          p_order_id: string
          p_stars: number
          p_tags?: string[]
        }
        Returns: string
      }
      declutter_link_haul_away: {
        Args: { p_item_ids: string[]; p_job_id: string }
        Returns: number
      }
      declutter_link_setup_job: {
        Args: { p_job_id: string; p_order_id: string }
        Returns: boolean
      }
      declutter_listing_round_close_offers: {
        Args: { p_item_id: string; p_seller: string; p_title: string }
        Returns: number
      }
      declutter_listing_rounds_sweep: { Args: never; Returns: Json }
      declutter_lock_buyable_item: {
        Args: { p_buyer: string; p_item_id: string }
        Returns: Record<string, unknown>
      }
      declutter_lock_order: {
        Args: { p_order_id: string }
        Returns: {
          buyer_id: string
          card_fee_cents: number | null
          close_reason: string | null
          closed_at: string | null
          created_at: string
          fee_rule: string
          handed_over_at: string | null
          handover: string
          id: string
          is_seed: boolean
          items_cents: number
          paid_at: string | null
          premium_cents: number
          seller_id: string
          status: string
          stripe_checkout_session_id: string | null
          stripe_paid_at: string | null
          stripe_payment_intent_id: string | null
          tax_cents: number
          total_cents: number
        }
        SetofOptions: {
          from: "*"
          to: "declutter_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      declutter_make_offer: {
        Args: { p_amount_cents: number; p_item_id: string }
        Returns: string
      }
      declutter_map_pins: {
        Args: never
        Returns: {
          item_id: string
          pin_lat: number
          pin_lng: number
        }[]
      }
      declutter_free_still_available: { Args: { p_item_id: string }; Returns: string }
      declutter_free_still_available_sweep: { Args: never; Returns: Json }
      declutter_mark_sold_elsewhere: { Args: { p_item_id: string }; Returns: string[] }
      declutter_mark_order_paid: {
        Args: {
          p_amount_cents: number
          p_card_fee_cents: number
          p_order_id: string
          p_paid_at: string
          p_payment_intent_id: string
        }
        Returns: Json
      }
      declutter_member_out: { Args: { p_user: string }; Returns: boolean }
      declutter_first_screen: { Args: { p_switch_keys: string[] }; Returns: Json }
      declutter_on_my_way: { Args: { p_order_id: string }; Returns: string }
      declutter_meetup_here: {
        Args: { p_order_id: string }
        Returns: string
      }
      declutter_meetup_rules: { Args: never; Returns: Json }
      declutter_meetup_spot_near_lines: {
        Args: { p_lines: string[]; p_spot_id: string }
        Returns: boolean
      }
      declutter_meetup_spots_near: {
        Args: { p_seller_id: string }
        Returns: { address: string; chosen: boolean; id: string; kind: string; miles: number; name: string; note: string; parish: string }[]
      }
      declutter_miles: {
        Args: { p_lat1: number; p_lat2: number; p_lng1: number; p_lng2: number }
        Returns: number
      }
      declutter_money_words: { Args: { p_cents: number }; Returns: string }
      declutter_move_out_date_problem: {
        Args: { p_move_out_on: string }
        Returns: string
      }
      declutter_my_donations: {
        Args: { p_item_ids?: string[] }
        Returns: {
          chosen_at: string
          donated_at: string
          item_id: string
          item_title: string
          partner_address: string
          partner_name: string
          receipt: boolean
        }[]
      }
      declutter_my_moving_sale: {
        Args: never
        Returns: {
          sale_name: string
          sale_starts_on: string
        }[]
      }
      declutter_my_move_out_date: { Args: never; Returns: string }
      declutter_my_order_talks: { Args: never; Returns: Json }
      declutter_my_question_ids: { Args: { p_item_id: string }; Returns: string[] }
      declutter_miles_between: {
        Args: { p_lat1: number; p_lat2: number; p_lng1: number; p_lng2: number }
        Returns: number
      }
      declutter_my_cart: {
        Args: never
        Returns: {
          checkout_by: string
          closed_at: string | null
          delivery_cents: number | null
          delivery_task_id: string | null
          handover: string | null
          item_id: string
          item_title: string
          line_id: string
          my_side: string
          order_id: string | null
          order_status: string | null
          porch_ok: boolean
          handovers: string[] | null
          premium_cents: number | null
          price_cents: number
          seller_id: string
          source: string
          status: string
          total_cents: number | null
        }[]
      }
      declutter_my_cart_lines: {
        Args: { p_buyer: string; p_seller: string }
        Returns: string[]
      }
      declutter_my_handover: { Args: { p_order_id: string }; Returns: Json }
      declutter_my_item_review: {
        Args: { p_item_id: string }
        Returns: {
          ai_flagged: boolean
          review_note: string
        }[]
      }
      declutter_my_offers: {
        Args: never
        Returns: {
          amount_cents: number
          awaiting: string
          counter_count: number
          current_price_cents: number
          floor_price_cents: number | null
          from_wanted: boolean
          item_id: string
          item_title: string
          my_side: string
          offer_id: string
          open_wanted_id: string
          respond_by: string
          status: string
          updated_at: string
        }[]
      }
      declutter_my_paid_cents: {
        Args: { p_order_ids: string[] }
        Returns: {
          order_id: string
          paid_cents: number
        }[]
      }
      declutter_my_porch_days: { Args: never; Returns: number[] }
      declutter_my_porch_places: {
        Args: never
        Returns: { address: string; area: string; id: string; label: string; lat: number; lng: number; position: number; weekdays: number[]; windows: Json }[]
      }
      declutter_save_porch_place: {
        Args: { p_address: string; p_area: string; p_label: string; p_lat: number; p_lng: number; p_place_id: string; p_weekdays: number[]; p_windows?: Json }
        Returns: string
      }
      declutter_delete_porch_place: { Args: { p_place_id: string }; Returns: string }
      declutter_seller_porch_places: {
        Args: { p_seller_id: string }
        Returns: { area: string; chosen: boolean; id: string; label: string; weekdays: number[]; windows: Json }[]
      }
      declutter_item_pickup_places: {
        Args: { p_item_id: string }
        Returns: { area: string; label: string; weekdays: number[]; windows: Json }[]
      }
      declutter_set_porch_place: { Args: { p_place_id: string; p_seller_id: string }; Returns: string }
      declutter_order_place: {
        Args: { p_order_id: string }
        Returns: { address: string; area: string; label: string; lat: number; lng: number; weekdays: number[] }[]
      }
      declutter_order_pickup_points: {
        Args: { p_order_id: string }
        Returns: { address: string; lat: number; lng: number }[]
      }
      declutter_order_is_porch_day: { Args: { p_dow: number; p_order_id: string }; Returns: boolean }
      declutter_my_seller_delivery: { Args: never; Returns: Json }
      declutter_my_wanted: {
        Args: never
        Returns: {
          category: string
          created_at: string
          expires_at: string
          id: string
          matches: Json
          max_price_cents: number
          photo_paths: string[]
          public: boolean
          radius_miles: number
          replies: Json
          status: string
          what: string
        }[]
      }
      declutter_new_handover_code: { Args: never; Returns: string }
      declutter_notice_about: { Args: { p_order_id: string }; Returns: undefined }
      declutter_notice_names_item: {
        Args: {
          p_link: string
          p_message: string
          p_other: string
          p_user: string
        }
        Returns: string
      }
      declutter_delivery_tip_open: { Args: { p_order_id: string }; Returns: boolean }
      declutter_order_items_named: { Args: { p_order_id: string }; Returns: string }
      declutter_paid_next_step: { Args: { p_order_id: string }; Returns: string }
      declutter_pickup_anchor: {
        Args: { p_pickup_day: string; p_slot_start: string }
        Returns: string
      }
      declutter_remove_wanted_photo: {
        Args: { p_storage_path: string; p_wanted_id: string }
        Returns: number
      }
      declutter_seller_sold_count: { Args: { p_seller_id: string }; Returns: number }
      declutter_notice_link: { Args: { p_link: string }; Returns: string }
      declutter_notice_order_link: {
        Args: { p_link: string; p_other: string; p_user: string }
        Returns: string
      }
      declutter_notice_type: {
        Args: { p_link: string; p_title: string; p_type: string }
        Returns: string
      }
      declutter_notify: {
        Args: {
          p_link: string
          p_message: string
          p_other?: string
          p_title: string
          p_type: string
          p_user: string
        }
        Returns: undefined
      }
      declutter_notify_strict: {
        Args: {
          p_link: string
          p_message: string
          p_other?: string
          p_title: string
          p_type: string
          p_user: string
        }
        Returns: undefined
      }
      declutter_order_problem: { Args: { p_order_id: string }; Returns: Json }
      declutter_order_refunds_recorded_cents: { Args: { p_order_id: string }; Returns: number }
      declutter_order_side: {
        Args: { p_buyer: string; p_seller: string; p_uid: string }
        Returns: string
      }
      declutter_payout_executed: {
        Args: {
          p_error: string
          p_payout_id: string
          p_succeeded: boolean
          p_transfer_id: string
        }
        Returns: string
      }
      declutter_payout_take_setup_fee: {
        Args: { p_payout_id: string }
        Returns: number
      }
      declutter_payout_unsent: { Args: { p_order_id: string }; Returns: boolean }
      declutter_payouts_due: {
        Args: { p_limit: number }
        Returns: {
          amount_cents: number
          attempts: number
          buyer_id: string
          order_id: string
          payment_intent_id: string
          payout_id: string
          seller_id: string
          stripe_account_id: string
        }[]
      }
      declutter_pick_drop_stop: { Args: { p_floor: number }; Returns: number }
      declutter_pickup_remind: {
        Args: {
          p_link: string
          p_message: string
          p_other: string
          p_title: string
          p_user: string
        }
        Returns: undefined
      }
      declutter_pickup_reminder_sweep: { Args: never; Returns: number }
      declutter_porch_days: { Args: { p_order_id: string }; Returns: string[] }
      declutter_porch_note: {
        Args: { p_note: string; p_order_id: string }
        Returns: string
      }
      declutter_porch_photo: {
        Args: {
          p_lat: number
          p_lng: number
          p_order_id: string
          p_photo_path: string
        }
        Returns: Json
      }
      declutter_price_drop_sweep: { Args: never; Returns: number }
      declutter_price_nudge_cents: {
        Args: { p_current: number; p_floor: number }
        Returns: number
      }
      declutter_move_reminder_sweep: { Args: never; Returns: Json }
      declutter_price_nudge_sweep: { Args: never; Returns: Json }
      declutter_price_hint: {
        Args: {
          p_category: string
          p_condition_stars: number
          p_lat: number
          p_lng: number
        }
        Returns: {
          high_cents: number
          low_cents: number
          sales: number
        }[]
      }
      declutter_price_text: { Args: { p_cents: number }; Returns: string }
      declutter_price_words: { Args: { p_text: string }; Returns: string }
      declutter_problem_add_side: {
        Args: { p_note: string; p_photo_paths?: string[]; p_problem_id: string }
        Returns: Json
      }
      declutter_problem_window_open: { Args: { p_order_id: string }; Returns: boolean }
      declutter_propose_delivery_time: { Args: { p_order_id: string; p_slot_start: string }; Returns: Json }
      declutter_publish_item: { Args: { p_item_id: string }; Returns: string }
      declutter_raise_card_fee_kept_reasons: { Args: never; Returns: string[] }
      declutter_raise_seller_fault_reasons: { Args: never; Returns: string[] }
      declutter_rebook_payout: {
        Args: { p_order_id: string; p_refunded_cents: number }
        Returns: number
      }
      declutter_record_ai_check: {
        Args: {
          p_flag_reason: string
          p_item_id: string
          p_judged_category: string
          p_judged_description: string
          p_judged_photo_ids: string[]
          p_judged_title: string
          p_seller_id: string
        }
        Returns: string
      }
      declutter_record_hand_refund: {
        Args: {
          p_amount_cents: number
          p_livemode: boolean
          p_payment_intent_id: string
          p_stripe_refund_id: string
        }
        Returns: string
      }
      declutter_record_refund: {
        Args: {
          p_card_fee_cents: number
          p_order_id: string
          p_paid_cents: number
          p_payment_intent_id: string
          p_reason: string
        }
        Returns: string
      }
      declutter_refresh_seller_hidden: { Args: { p_seller: string }; Returns: undefined }
      declutter_reopen_voided_offers: { Args: { p_line: string }; Returns: number }
      declutter_refund_after_handover: {
        Args: { p_order_id: string; p_part_cents: number; p_reason: string }
        Returns: Json
      }
      declutter_refund_answer: { Args: { p_refund_id: string }; Returns: Json }
      declutter_refund_executed: {
        Args: {
          p_refund_id: string
          p_stripe_refund_id: string
          p_succeeded: boolean
        }
        Returns: string
      }
      declutter_refund_gave_up_check: {
        Args: { p_refund_id?: string }
        Returns: number
      }
      declutter_refund_paid_order: { Args: { p_order_id: string; p_reason: string }; Returns: Json }
      declutter_refund_party_gone: {
        Args: {
          p_amount_cents: number
          p_card_fee_cents: number
          p_order_id: string
          p_payment_intent_id: string
        }
        Returns: Json
      }
      declutter_refund_request_sweep: { Args: never; Returns: Json }
      declutter_refund_request_to_admin: {
        Args: { p_request_id: string; p_why: string }
        Returns: string
      }
      declutter_refund_request_view: { Args: { p_order_id: string }; Returns: Json }
      declutter_refund_reversed: {
        Args: { p_refund_id: string; p_stripe_refund_id: string; p_why: string }
        Returns: string
      }
      declutter_refund_set_mode: {
        Args: { p_livemode: boolean; p_refund_id: string }
        Returns: boolean
      }
      declutter_refunds_due: {
        Args: { p_limit: number }
        Returns: {
          attempts: number
          buyer_id: string
          checkout_session_id: string
          livemode: boolean
          order_id: string
          payment_intent_id: string
          reason: string
          refund_cents: number
          refund_id: string
          seller_id: string
        }[]
      }
      declutter_remove_item_photo: { Args: { p_photo_id: string }; Returns: string }
      declutter_report_helpr_no_show: { Args: { p_order_id: string }; Returns: Json }
      declutter_helpr_answer_no_show: {
        Args: { p_note: string; p_photo_path?: string; p_task_id: string }
        Returns: string
      }
      declutter_no_helpr_choice: { Args: { p_order_id: string }; Returns: Json }
      declutter_no_helpr_refusal: { Args: { p_order_id: string }; Returns: string }
      declutter_report_no_show: { Args: { p_order_id: string }; Returns: Json }
      declutter_held_address_closed: { Args: { p_order_id: string }; Returns: boolean }
      declutter_start_no_show_answer: { Args: { p_order_id: string }; Returns: Json }
      declutter_answer_no_show: {
        Args: { p_note: string; p_order_id: string; p_photo_paths?: string[] }
        Returns: string
      }
      declutter_report_not_delivered: { Args: { p_order_id: string }; Returns: Json }
      declutter_report_problem: {
        Args: {
          p_note: string
          p_order_id: string
          p_photo_paths: string[]
          p_reason: string
        }
        Returns: string
      }
      declutter_respond_offer: {
        Args: { p_action: string; p_amount_cents: number | null; p_offer_id: string }
        Returns: string
      }
      declutter_retire_order: {
        Args: { p_buyer: string; p_order_id: string; p_session_id: string }
        Returns: boolean
      }
      declutter_review_tags_for: { Args: { p_side: string }; Returns: string[] }
      declutter_road_miles: { Args: { p_lat1: number; p_lat2: number; p_lng1: number; p_lng2: number }; Returns: number }
      declutter_sale_decided: { Args: { p_order_id: string }; Returns: boolean }
      declutter_sale_final: { Args: { p_order_id: string }; Returns: boolean }
      declutter_save_card: {
        Args: {
          p_brand: string
          p_customer: string
          p_last4: string
          p_mode: string
          p_payment_method: string
          p_user: string
        }
        Returns: undefined
      }
      declutter_scrub_member: { Args: { p_user_id: string }; Returns: Json }
      declutter_search_matches: {
        Args: { p_category: string; p_description: string; p_query: string; p_title: string }
        Returns: boolean
      }
      declutter_search_stem: { Args: { p_word: string }; Returns: string }
      declutter_seller_cancel_delivery: { Args: { p_order_id: string }; Returns: Json }
      declutter_seller_cancel_sale: { Args: { p_item_id: string }; Returns: number }
      declutter_seller_delivered: {
        Args: {
          p_lat?: number
          p_lng?: number
          p_order_id: string
          p_photo_path: string
        }
        Returns: Json
      }
      declutter_seller_delivery_booking: { Args: { p_order_id: string }; Returns: Json }
      declutter_seller_delivery_check: { Args: { p_buyer: string; p_lines: string[]; p_seller: string }; Returns: unknown }
      declutter_seller_delivery_offer: { Args: { p_seller_id: string }; Returns: Json }
      declutter_seller_delivery_rate_cents: {
        Args: { p_free_over_cents: number; p_items_cents: number; p_rate_cents: number }
        Returns: number
      }
      declutter_seller_delivery_rules: { Args: never; Returns: Json }
      declutter_seller_hidden: { Args: { p_seller: string }; Returns: boolean }
      declutter_seller_hidden_sweep: { Args: never; Returns: Json }
      declutter_seller_moving_sale: {
        Args: { p_seller_id: string }
        Returns: {
          move_out_on: string
          sale_name: string
          sale_starts_on: string
        }[]
      }
      declutter_seller_item_private: {
        Args: { p_item_id: string }
        Returns: {
          auto_offers: boolean
          floor_price_cents: number
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
        }[]
      }
      declutter_seller_out: { Args: { p_seller: string }; Returns: boolean }
      declutter_seller_picked_up: {
        Args: {
          p_lat?: number
          p_lng?: number
          p_order_id: string
          p_photo_path: string
        }
        Returns: Json
      }
      declutter_seller_out_fee_notice: {
        Args: { p_refund_id: string }
        Returns: undefined
      }
      declutter_set_delivery_handoff: { Args: { p_handoff: string; p_order_id: string }; Returns: string }
      declutter_set_delivery_schedule: { Args: { p_days_off: string[]; p_windows: Json }; Returns: Json }
      declutter_set_item_seller_delivery: { Args: { p_item_id: string; p_on: boolean }; Returns: boolean }
      declutter_send_handover_message: {
        Args: { p_body: string; p_talk_id: string }
        Returns: string
      }
      declutter_send_order_message: {
        Args: { p_body: string; p_order_id: string }
        Returns: string
      }
      declutter_set_bundle_discount: {
        Args: { p_percent: number }
        Returns: number
      }
      declutter_set_meetup_spot: {
        Args: { p_seller_id: string; p_spot_id: string }
        Returns: string
      }
      declutter_set_move_out_date: {
        Args: { p_move_out_on: string | null }
        Returns: number
      }
      declutter_set_moving_sale: {
        Args: { p_name: string; p_starts_on: string }
        Returns: number
      }
      declutter_set_delivery_dropoff: { Args: { p_address: string; p_area_label: string; p_buyer: string; p_lat: number; p_lng: number; p_seller: string }; Returns: undefined }
      declutter_set_pickup_windows: { Args: { p_windows: Json }; Returns: number }
      declutter_set_drop_pct: {
        Args: { p_item_id: string; p_pct: number }
        Returns: number
      }
      declutter_set_handovers: {
        Args: { p_handovers: string[]; p_item_id: string }
        Returns: string[]
      }
      declutter_set_porch_ok: {
        Args: { p_item_id: string; p_porch_ok: boolean }
        Returns: boolean
      }
      declutter_set_porch_time: {
        Args: { p_mode: string; p_order_id: string; p_until: string }
        Returns: undefined
      }
      declutter_set_porch_days: {
        Args: { p_weekdays: number[] }
        Returns: number[]
      }
      declutter_set_seller_delivery: {
        Args: { p_enabled: boolean; p_free_over_cents?: number; p_radius_miles: number; p_rate_cents: number }
        Returns: Json
      }
      declutter_set_wanted_public: {
        Args: { p_public: boolean; p_wanted_id: string }
        Returns: boolean
      }
      declutter_set_watch: {
        Args: { p_item_id: string; p_watch: boolean }
        Returns: string
      }
      declutter_setup_helpr: { Args: { p_order_id: string }; Returns: Json }
      declutter_claim_setup_fee: { Args: { p_order_id: string }; Returns: string }
      declutter_setup_fee_due_cents: { Args: { p_user: string }; Returns: number }
      declutter_setup_fee_from_payout_cents: {
        Args: { p_seller: string }
        Returns: number
      }
      declutter_setup_fee_refund_reversed: {
        Args: { p_order_id: string; p_stripe_refund_id: string }
        Returns: string
      }
      declutter_setup_fee_refunded: {
        Args: { p_order_id: string; p_stripe_refund_id: string }
        Returns: string
      }
      declutter_setup_job_fee_debt: {
        Args: { p_card_fee_cents: number; p_job_id: string }
        Returns: number
      }
      declutter_slot_in_windows: {
        Args: { p_seller: string; p_start: string }
        Returns: boolean
      }
      declutter_start_checkout: {
        Args: { p_handoff?: string; p_handover: string; p_seller_id: string; p_slot_start?: string }
        Returns: {
          items_cents: number
          order_id: string
          premium_cents: number
          checkout_session_id: string | null
          delivery_cents: number
          superseded_session_id: string | null
          tax_cents: number
          total_cents: number
        }[]
      }
      declutter_take_item: {
        Args: {
          p_buyer: string
          p_item_id: string
          p_offer_id: string
          p_price: number
          p_source: string
        }
        Returns: string
      }
      declutter_update_draft: {
        Args: {
          p_area_label: string
          p_category: string
          p_condition_stars: number
          p_delivery_size: string
          p_description: string
          p_floor_price_cents: number
          p_item_id: string
          p_pickup_address: string
          p_pickup_lat: number
          p_pickup_lng: number
          p_price_cents: number
          p_title: string
        }
        Returns: string
      }
      declutter_visible_reviews: {
        Args: { p_user_id: string }
        Returns: {
          comment: string
          created_at: string
          id: string
          reviewer_side: string
          stars: number
          tags: string[]
        }[]
      }
      declutter_wanted_email: {
        Args: {
          p_link: string
          p_message: string
          p_title: string
          p_user: string
        }
        Returns: undefined
      }
      declutter_update_wanted: {
        Args: {
          p_category: string
          p_max_price_cents: number
          p_radius_miles: number
          p_wanted_id: string
          p_what: string
        }
        Returns: string
      }
      declutter_admin_remove_question: {
        Args: { p_note: string; p_part: string; p_question_id: string; p_report_id: string }
        Returns: string
      }
      declutter_admin_reported_questions: {
        Args: { p_question_ids: string[] }
        Returns: {
          answer: string
          asker_id: string
          is_seed: boolean
          item_id: string
          item_title: string
          question: string
          question_id: string
          removed: boolean
          seller_id: string
        }[]
      }
      declutter_admin_reported_wanted: {
        Args: { p_wanted_ids: string[] }
        Returns: {
          is_seed: boolean
          photo_paths: string[]
          photos_held: string[]
          poster_id: string
          removed: boolean
          status: string
          wanted_id: string
          what: string
        }[]
      }
      declutter_admin_release_wanted_photos: {
        Args: { p_report_id: string; p_wanted_id: string }
        Returns: string
      }
      declutter_admin_take_down_wanted: {
        Args: { p_note: string; p_report_id?: string; p_wanted_id: string }
        Returns: string
      }
      declutter_block_wanted_poster: { Args: { p_wanted_id: string }; Returns: string }
      declutter_reopen_wanted: { Args: { p_wanted_id: string }; Returns: string }
      declutter_remove_wanted: { Args: { p_wanted_id: string }; Returns: string[] }
      declutter_my_reply_listings: {
        Args: { p_wanted_id: string }
        Returns: {
          current_price_cents: number
          id: string
          refuses: string
          title: string
        }[]
      }
      declutter_wanted_browse: {
        Args: { p_lat: number; p_lng: number }
        Returns: {
          category: string
          expires_at: string
          id: string
          max_price_cents: number
          miles: number
          photo_path: string
          photo_paths: string[]
          poster_name: string
          replied: boolean
          what: string
        }[]
      }
      declutter_wanted_reply: {
        Args: { p_amount_cents: number; p_item_id: string; p_wanted_id: string }
        Returns: string
      }
      declutter_wanted_snap_miles: {
        Args: { p_lat: number; p_lng: number; w_lat: number; w_lng: number }
        Returns: number
      }
      declutter_wanted_alert_block: {
        Args: { p_user: string }
        Returns: string
      }
      declutter_wanted_match_item: {
        Args: { p_item: string }
        Returns: number
      }
      declutter_wanted_notify: {
        Args: { p_link: string; p_message: string; p_title: string; p_user: string }
        Returns: number
      }
      declutter_wanted_pairs: {
        Args: { p_item: string; p_wanted: string; p_with_blocked: boolean }
        Returns: {
          item_id: string
          miles: number
          wanted_id: string
        }[]
      }
      declutter_wanted_record_match: {
        Args: {
          p_item: string
          p_tell_poster: boolean
          p_tell_seller: boolean
          p_wanted: string
        }
        Returns: number
      }
      declutter_wanted_sweep: { Args: never; Returns: Json }
      declutter_wanted_category_near: { Args: { p_category: string }; Returns: string[] }
      declutter_wanted_text_problem: { Args: { p_what: string }; Returns: string }
      declutter_wanted_tsquery: { Args: { p_what: string }; Returns: unknown }
      declutter_listing_manage_state: {
        Args: { p_item_id: string }
        Returns: {
          drops_stopped: boolean
          floor_price_cents: number
        }[]
      }
      declutter_pause_listing: { Args: { p_item_id: string }; Returns: string }
      declutter_relist_listing: { Args: { p_item_id: string }; Returns: string }
      declutter_remove_cart_item: { Args: { p_line_id: string }; Returns: string }
      declutter_reopen_listing: { Args: { p_item_id: string }; Returns: string }
      declutter_set_auto_free: { Args: { p_item_id: string; p_on: boolean }; Returns: boolean }
      declutter_set_auto_free_days: {
        Args: { p_days: number; p_item_id: string }
        Returns: number
      }
      declutter_set_keep_up: { Args: { p_item_id: string; p_on: boolean }; Returns: boolean }
      declutter_set_listing_drops: {
        Args: { p_item_id: string; p_on: boolean }
        Returns: boolean
      }
      declutter_set_offer_rules: {
        Args: {
          p_accepts_offers: boolean
          p_auto_offers: boolean
          p_item_id: string
        }
        Returns: undefined
      }
      declutter_set_listing_price: {
        Args: {
          p_floor_price_cents: number
          p_item_id: string
          p_price_cents: number
        }
        Returns: number
      }
      declutter_withdraw_item: { Args: { p_item_id: string }; Returns: string[] }
      declutter_withdraw_problem: { Args: { p_problem_id: string }; Returns: Json }
      declutter_withdraw_refund: { Args: { p_request_id: string }; Returns: Json }
      declutter_refund_item_returned: { Args: { p_photo_path?: string; p_request_id: string }; Returns: Json }
      declutter_accept_refund_with_return: {
        Args: { p_at: string; p_day: string; p_request_id: string; p_way: string }
        Returns: Json
      }
      declutter_return_backstop_at: {
        Args: {
          r: Database["public"]["Tables"]["declutter_refund_requests"]["Row"]
        }
        Returns: string
      }
      declutter_return_photo_ok: {
        Args: { p_order_id: string; p_path: string; p_uid: string }
        Returns: boolean
      }
      declutter_return_dropped_off: {
        Args: { p_lat: number; p_lng: number; p_photo_path: string; p_request_id: string }
        Returns: Json
      }
      declutter_set_return_address: {
        Args: { p_address: string; p_lat: number; p_lng: number; p_request_id: string }
        Returns: Json
      }
      end_recurring_series_by_platform: {
        Args: {
          p_admin?: string
          p_job_id: string
          p_kind: string
          p_reason: string
        }
        Returns: Json
      }
      facilitated_la_sales_cents: {
        Args: { p_year: number }
        Returns: number
      }
      facilitator_alert_sent: {
        Args: { p_year: number }
        Returns: undefined
      }
      facilitator_threshold_check: { Args: never; Returns: Json }
      file_approval_escalation: {
        Args: { p_anchor: string; p_job_id: string; p_reason: string }
        Returns: boolean
      }
      get_my_job_card_hold: {
        Args: { p_job_id: string }
        Returns: {
          amount_cents: number
          capture_before: string | null
          onboarding_fee_cents: number
          place_at: string | null
          state: string
        }[]
      }
      get_my_job_quotes: {
        Args: never
        Returns: {
          available_note: string
          created_at: string
          date_needed: string
          id: string
          job_id: string
          job_payment: "paid" | "bank_pending" | "unpaid" | "closed" | null
          last_offer_side: string
          note: string
          offers: Json
          parish: string
          price_cents: number
          request_id: string
          respond_until: string
          status: string
          title: string
        }[]
      }
      get_my_quote_requests: {
        Args: never
        Returns: {
          category: string
          created_at: string
          date_needed: string
          id: string
          job_id: string
          parish: string
          quote_count: number
          quotes_close_at: string
          status: string
          title: string
          window_hours: number
        }[]
      }
      get_my_sms_consent: { Args: never; Returns: Json }
      job_reminder_kind: {
        Args: { p_message: string; p_title: string; p_type: string }
        Returns: {
          always_on: boolean
          kind: string
          pref_column: string
        }[]
      }
      job_reminder_switched_off: {
        Args: {
          p_message: string
          p_title: string
          p_type: string
          p_user_id: string
        }
        Returns: boolean
      }
      my_job_post_draft: { Args: never; Returns: Json }
      objectionable_reason: { Args: { p_text: string }; Returns: string }
      referral_member_has_completed_job: {
        Args: { p_user: string }
        Returns: boolean
      }
      referral_settle_for: {
        Args: { p_job_id: string; p_user: string }
        Returns: undefined
      }
      save_my_job_post_draft: { Args: { p_draft: Json }; Returns: undefined }
      sell_for_me_listings_sent: {
        Args: {
          _job_id: string
        }
        Returns: boolean
      }
      sms_claim_owner_support: {
        Args: { p_phone?: string; p_provider_ready: boolean }
        Returns: Json
      }
      sms_phone_prompt_due: { Args: { p_moment: string }; Returns: boolean }
      dismiss_sms_phone_prompt: { Args: never; Returns: string }
      get_quotes_for_request: {
        Args: { p_request_id: string }
        Returns: {
          available_note: string
          created_at: string
          id: string
          last_offer_side: string
          note: string
          offers: Json
          photo_paths: string[]
          price_cents: number
          quoter_avatar_url: string
          quoter_id: string
          quoter_name: string
          respond_until: string
          status: string
        }[]
      }
      homes_sale_wording_flags: {
        Args: { p_text: string }
        Returns: string[]
      }
      job_match_email_should_wait: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      job_offer_cutoff: {
        Args: { p_date_needed: string; p_start_time: string }
        Returns: string
      }
      choose_new_social_account: {
        Args: { p_choice: string }
        Returns: boolean
      }
      claim_checkout_nudge: {
        Args: {
          p_job_id: string
          p_owner_approved?: boolean
          p_session_id: string
          p_user_id: string
        }
        Returns: string
      }
      claim_dispute_settlement: {
        Args: { _action: string; _admin_id?: string; _job_id: string }
        Returns: Json
      }
      claim_idv_attempt: {
        Args: {
          p_max_attempts?: number
          p_restart?: boolean
          p_skip_fee_gate?: boolean
          p_user_id: string
        }
        Returns: Json
      }
      claim_marketing_content: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          body: string
          campaign: string | null
          channel: Database["public"]["Enums"]["marketing_channel"]
          created_at: string
          created_by: string | null
          external_id: string | null
          external_url: string | null
          generated_by: string | null
          hashtags: string[]
          id: string
          last_error: string | null
          locked_at: string | null
          media_urls: string[]
          model: string | null
          parish: string | null
          published_at: string | null
          scheduled_for: string | null
          status: Database["public"]["Enums"]["marketing_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "marketing_content"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_monthly_free_boost: {
        Args: { p_allowance: number; p_user_id: string }
        Returns: {
          claimed: boolean
          credit_month: string
          credits_used: number
        }[]
      }
      claim_my_referral_code: {
        Args: { p_code: string }
        Returns: string
      }
      claim_series_dates: {
        Args: { p_dates: string[]; p_job_id: string }
        Returns: Json
      }
      claim_signup_lead_reminders: {
        Args: { p_limit?: number }
        Returns: {
          email: string
          id: string
        }[]
      }
      claim_come_back_emails: {
        Args: { p_limit?: number; p_step: number }
        Returns: {
          email: string
          full_name: string
          user_id: string
        }[]
      }
      claim_payout_setup_reminders: {
        Args: { p_limit?: number }
        Returns: {
          helper_id: string
          job_id: string
          job_title: string
          reminder_key: string
          stage: string
        }[]
      }
      cleanup_observability_tables: { Args: never; Returns: Json }
      cleanup_stripe_webhook_events: { Args: never; Returns: number }
      clear_available_now: { Args: never; Returns: undefined }
      claim_stripe_customer: {
        Args: { p_customer: string; p_mode: string; p_user: string }
        Returns: string
      }
      clear_test_mode_dispute_ledger: {
        Args: {
          _admin: string
          _dispute_id: string
          _reason: string
          _refund_ids: string[]
          _transfer_ids: string[]
        }
        Returns: Json
      }
      clear_thread_mute: {
        Args: { _job_id: string; _other_user_id: string }
        Returns: boolean
      }
      complete_direct_offer_accept: {
        Args: { p_helper: string; p_job_id: string }
        Returns: Json
      }
      complete_job_accept: { Args: { p_job_id: string }; Returns: boolean }
      contact_leak_reason: { Args: { p_text: string }; Returns: string }
      credential_document_path_ok: {
        Args: { p_kind: string; p_path: string; p_user_id: string }
        Returns: boolean
      }
      crew_closed_spot_count: { Args: { p_job_id: string }; Returns: number }
      crew_completes_when_hired_done: { Args: never; Returns: boolean }
      crew_fee_pays_unconfirmed: { Args: never; Returns: boolean }
      crew_spots_open: { Args: { p_job_id: string }; Returns: number }
      crew_slot_share_cents: {
        Args: { p_needed: number; p_slot: number; p_total_cents: number }
        Returns: number
      }
      cron_catchup_last_slot: {
        Args: { p_at: string; p_schedule: string }
        Returns: {
          period: string
          slot: string
        }[]
      }
      cron_dispatch_health: {
        Args: never
        Returns: {
          active: boolean
          expected_max_gap: string
          jobname: string
          last_end: string
          last_message: string
          last_start: string
          last_status: string
          recent_failures: number
          registered_at: string
          runs_total: number
          schedule: string
        }[]
      }
      cron_http_tag: {
        Args: { p_jobname: string; p_request_id: number }
        Returns: number
      }
      cron_record_work: {
        Args: { p_job: string; p_result: Json }
        Returns: Json
      }
      cron_silent_rule: { Args: { p_sample_ref: Json }; Returns: string }
      cron_silent_still_failing: {
        Args: { p_job: string; p_rule: string; p_since: string }
        Returns: boolean
      }
      db_saturation_problems: { Args: { p: Json }; Returns: string[] }
      db_saturation_thresholds: { Args: never; Returns: Json }
      decline_job_offer: { Args: { p_application_id: string }; Returns: Json }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      deliver_job_match: { Args: { p_id: string }; Returns: boolean }
      deliver_parish_match_alert: {
        Args: { p_job_id: string; p_user_id: string }
        Returns: boolean
      }
      deliver_saved_search_alert: {
        Args: {
          p_job_id: string
          p_search_ids: string[]
          p_search_name: string
          p_user_id: string
        }
      deliver_saved_search_item_alerts: { Args: { p_item: string }; Returns: number }
        Returns: boolean
      }
      detect_stuck_payments: { Args: never; Returns: Json }
      detect_suspicious_user_patterns: { Args: never; Returns: number }
      direct_accept_block_reason: {
        Args: { p_helper: string; p_job_id: string }
        Returns: string
      }
      display_name_for_viewer: {
        Args: { p_full_name: string; p_owner_id: string }
        Returns: string
      }
      dispute_evidence_url_ok: {
        Args: { _job_id: string; _uploader: string; _url: string }
        Returns: boolean
      }
      dispute_settlement_claim_ttl: { Args: never; Returns: string }
      early_access_cutoff: { Args: never; Returns: string }
      early_access_delay_minutes: {
        Args: { p_user_id: string }
        Returns: number
      }
      early_access_visible_at: {
        Args: { p_created_at: string; p_user_id: string }
        Returns: string
      }
      end_recurring_series: { Args: { p_job_id: string }; Returns: Json }
      end_series_for_banned_account: {
        Args: { p_user: string }
        Returns: number
      }
      enforce_retained_ban: {
        Args: {
          p_email?: string
          p_identity_sha256?: string
          p_phone?: string
          p_user_id: string
        }
        Returns: Json
      }
      enforce_retained_payment_ban: {
        Args: {
          p_kind: string
          p_stripe_fingerprint: string
          p_user_id: string
        }
        Returns: Json
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      enqueue_instant_job_match: {
        Args: { p_job_id: string; p_matches: Json }
        Returns: Json
      }
      error_log_is_seed: { Args: { p_tags: Json }; Returns: boolean }
      expire_pending_direct_offers: { Args: never; Returns: number }
      expire_unanswered_offers: { Args: never; Returns: number }
      expire_unanswered_schedule_changes: { Args: never; Returns: number }
      export_my_data: { Args: { p_user_id: string }; Returns: Json }
      extend_boosts_with_no_applications: {
        Args: never
        Returns: {
          job_id: string
          new_expires_at: string
        }[]
      }
      feature_enabled_for: { Args: { p_key: string }; Returns: boolean }
      feature_enabled_for_user: {
        Args: { p_key: string; p_user_id: string }
        Returns: boolean
      }
      feature_switches_for_me: { Args: { p_keys: string[] }; Returns: Json }
      features_open_to_everyone: { Args: never; Returns: string[] }
      find_helprs: {
        Args: { p_limit?: number; p_skill?: string; p_town?: string }
        Returns: {
          avatar_url: string
          full_name: string
          is_id_verified: boolean
          parish: string
          skills: string
          town: string
          user_id: string
        }[]
      }
      flag_possible_ban_evasion_by_identity: {
        Args: { p_nodoc_sha256: string; p_user_id: string }
        Returns: Json
      }
      get_applicant_category_counts: {
        Args: { p_job_id: string }
        Returns: {
          category_completed: number
          helper_id: string
        }[]
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
      get_helper_analytics: { Args: { p_days?: number }; Returns: Json }
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
          band: string
          band_rank: number
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
      get_job_customer_id: { Args: { _job_id: string }; Returns: string }
      get_job_match_reach: { Args: { p_job_id: string }; Returns: number }
      get_job_offer_targets: {
        Args: { p_job_ids?: string[] }
        Returns: {
          job_id: string
          offered_to_helper_id: string
        }[]
      }
      get_job_pets: {
        Args: { p_job_id: string }
        Returns: {
          age_years: number
          behavioral_notes: string
          breed: string
          color_markings: string
          emergency_contact: string
          feeding_schedule: string
          id: string
          medical_notes: string
          microchip_id: string
          name: string
          photo_url: string
          species: string
          vet_name: string
          vet_phone: string
          weight_lbs: number
        }[]
      }
      get_job_view_counts: {
        Args: { p_job_ids: string[] }
        Returns: {
          job_id: string
          view_count: number
        }[]
      }
      get_closed_application_job_labels: {
        Args: never
        Returns: {
          date_needed: string
          job_id: string
          title: string
        }[]
      }
      get_jobs_for_my_applications: {
        Args: never
        Returns: {
          accepted_at: string | null
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
          chargeback_evidence_due_by: string | null
          client_request_id: string | null
          commission_tax_amount: number | null
          completed_at: string | null
          created_at: string
          credential_tier: number
          customer_fee_amount: number | null
          customer_id: string | null
          date_needed: string
          dayof_confirm_reminder_sent_at: string | null
          dayof_unanswered_poster_alert_sent_at: string | null
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
          expiring_final_notif_sent: boolean | null
          expiring_notif_sent: boolean | null
          flag_reasons: string[] | null
          has_active_dispute: boolean
          helper_arrival_near_miss_at: string | null
          helper_arrival_near_miss_ft: number | null
          helper_arrival_verified_at: string | null
          helper_arrived_at: string | null
          helper_completed_at: string | null
          helper_confirmed_at: string | null
          helper_dayof_confirmed_at: string | null
          helper_fee_flat_cents: number | null
          helper_fee_percent: number | null
          helper_id: string | null
          helper_on_the_way_at: string | null
          helpers_needed: number | null
          id: string
          is_auto_created: boolean
          is_flexible_schedule: boolean
          is_group_job: boolean | null
          is_recurring: boolean | null
          is_seed: boolean
          is_urgent: boolean | null
          late_cancellation: boolean | null
          last_edit_notice_at: string | null
          latitude: number | null
          location: string | null
          longitude: number | null
          materials_note: string | null
          no_show_alert_sent_at: string | null
          offered_to_helper_id: string | null
          onboarding_fee_amount: number | null
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
          poster_fee_flat_cents: number | null
          poster_marked_done_at: string | null
          pricing_mode: string
          proof_after_urls: string[] | null
          proof_before_urls: string[] | null
          protection_fee: number | null
          recurrence_days: number[] | null
          recurrence_end_date: string | null
          recurrence_interval: string | null
          recurrence_weeks: number | null
          recurring_helper_id: string | null
          release_last_chance_notif_sent_at: string | null
          removal_reason: string | null
          removed_at: string | null
          removed_by: string | null
          require_photo_proof: boolean
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
          scope_video_url: string | null
          series_ban_cancelled_at: string | null
          series_ended_on: string | null
          series_split_ok: boolean
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
        }[]
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_message_thread_job_titles: {
        Args: { p_job_ids: string[] }
        Returns: {
          job_id: string
          title: string
        }[]
      }
      get_messaging_closes_at: {
        Args: { _job_ids: string[] }
        Returns: {
          closes_at: string
          job_id: string
          server_now: string
        }[]
      }
      get_muted_threads: {
        Args: { _pairs: Json }
        Returns: {
          job_id: string
          mute_until: string
          other_user_id: string
        }[]
      }
      get_my_pending_direct_offers: {
        Args: never
        Returns: {
          accepted_at: string | null
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
          chargeback_evidence_due_by: string | null
          client_request_id: string | null
          commission_tax_amount: number | null
          completed_at: string | null
          created_at: string
          credential_tier: number
          customer_fee_amount: number | null
          customer_id: string | null
          date_needed: string
          dayof_confirm_reminder_sent_at: string | null
          dayof_unanswered_poster_alert_sent_at: string | null
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
          expiring_final_notif_sent: boolean | null
          expiring_notif_sent: boolean | null
          flag_reasons: string[] | null
          has_active_dispute: boolean
          helper_arrival_near_miss_at: string | null
          helper_arrival_near_miss_ft: number | null
          helper_arrival_verified_at: string | null
          helper_arrived_at: string | null
          helper_completed_at: string | null
          helper_confirmed_at: string | null
          helper_dayof_confirmed_at: string | null
          helper_fee_flat_cents: number | null
          helper_fee_percent: number | null
          helper_id: string | null
          helper_on_the_way_at: string | null
          helpers_needed: number | null
          id: string
          is_auto_created: boolean
          is_flexible_schedule: boolean
          is_group_job: boolean | null
          is_recurring: boolean | null
          is_seed: boolean
          is_urgent: boolean | null
          late_cancellation: boolean | null
          last_edit_notice_at: string | null
          latitude: number | null
          location: string | null
          longitude: number | null
          materials_note: string | null
          no_show_alert_sent_at: string | null
          offered_to_helper_id: string | null
          onboarding_fee_amount: number | null
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
          poster_fee_flat_cents: number | null
          poster_marked_done_at: string | null
          pricing_mode: string
          proof_after_urls: string[] | null
          proof_before_urls: string[] | null
          protection_fee: number | null
          recurrence_days: number[] | null
          recurrence_end_date: string | null
          recurrence_interval: string | null
          recurrence_weeks: number | null
          recurring_helper_id: string | null
          release_last_chance_notif_sent_at: string | null
          removal_reason: string | null
          removed_at: string | null
          removed_by: string | null
          require_photo_proof: boolean
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
          scope_video_url: string | null
          series_ban_cancelled_at: string | null
          series_ended_on: string | null
          series_split_ok: boolean
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
        }[]
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_my_reply_latency: {
        Args: never
        Returns: {
          median_reply_minutes: number
          reply_sample: number
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
        Args: { p_helper_id: string; p_job_id: string }
        Returns: number
      }
      get_off_job_thread_state: {
        Args: { _job_id: string; _other: string }
        Returns: string
      }
      get_open_jobs_for_map: {
        Args: never
        Returns: {
          boost_expires_at: string
          budget: number
          category: string
          created_at: string
          date_needed: string
          expires_at: string
          helpers_needed: number
          id: string
          is_group_job: boolean
          is_urgent: boolean
          latitude: number
          location: string
          longitude: number
          parish: string
          start_time: string
          title: string
          urgent_fee: number
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
      get_parish_for_city: { Args: { p_city: string }; Returns: string }
      get_parish_for_zip: { Args: { p_zip: string }; Returns: string }
      get_payout_batch_job_ids: {
        Args: { p_helper_id: string }
        Returns: {
          job_id: string
        }[]
      }
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
      get_pending_credentials: {
        Args: never
        Returns: {
          avatar_url: string
          business_name: string
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
      get_price_guidance: {
        Args: { p_category: string }
        Returns: {
          high_dollars: number
          low_dollars: number
          sample_count: number
        }[]
      }
      get_public_platform_settings: {
        Args: never
        Returns: {
          customer_fee_percent: number
          feature_flags: Json
          helper_fee_percent: number
          hybrid_idv_enabled: boolean
          id: string
          idv_auto_approve_threshold: number
          min_supported_build: number
          onboarding_fee_cents: number
        }[]
      }
      get_public_profile_reviews: {
        Args: { p_limit?: number; p_offset?: number; p_user_id: string }
        Returns: {
          created_at: string
          feedback: string
          id: string
          job_category: string
          rating: number
          response_at: string
          response_text: string
          reviewer_name: string
          total_count: number
        }[]
      }
      get_public_profile_stats: {
        Args: { p_user_ids: string[] }
        Returns: {
          avg_rating: number
          cancellation_rate: number
          cancelled_jobs: number
          completed_jobs_as_helper: number
          completed_jobs_total: number
          has_pending_credentials: boolean
          has_stripe_account: boolean
          is_background_checked: boolean
          is_id_verified: boolean
          jobs_total: number
          on_time_rate: number
          on_time_sample: number
          posted_jobs_total: number
          poster_avg_rating: number
          poster_review_count: number
          repeat_client_sample: number
          repeat_hire_percent: number
          review_count: number
          revision_rate: number
          revision_sample: number
          user_id: string
        }[]
      }
      get_reply_speed: {
        Args: { p_user_ids: string[] }
        Returns: {
          reply_bucket: string
          user_id: string
        }[]
      }
      get_ranked_open_jobs: {
        Args: {
          p_include_seed?: boolean
          p_lat?: number
          p_limit?: number
          p_lng?: number
          p_max_miles?: number
          p_offset?: number
        }
        Returns: {
          boost_expires_at: string
          boosted_at: string
          budget: number
          category: Database["public"]["Enums"]["job_category"]
          created_at: string
          date_needed: string
          description: string
          distance_band: string
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
          recurrence_interval: string
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
          business_name: string
          created_at: string
          full_name: string
          hourly_rate: number
          insurance_status: string
          is_id_verified: boolean
          is_insured: boolean
          is_licensed: boolean
          is_payout_ready: boolean
          license_status: string
          location: string
          portfolio_urls: string[]
          profile_id: string
          role: string
          skills: string
          subscription_tier: string
          user_id: string
        }[]
      }
      get_service_role_key: { Args: never; Returns: string }
      get_supabase_url: { Args: never; Returns: string }
      get_thread_counterparty_deleted: {
        Args: { _job_id: string; _other: string }
        Returns: boolean
      }
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
      give_up_series_dates: {
        Args: { p_dates: string[]; p_job_id: string }
        Returns: Json
      }
      group_member_slot: {
        Args: { _job_id: string; _user_id: string }
        Returns: string
      }
      handover_photo_is_fresh: {
        Args: { p_bucket: string; p_path: string }
        Returns: boolean
      }
      has_pre_verification_wipe: { Args: never; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      helper_abort_job: {
        Args: { p_job_id: string; p_reason: string }
        Returns: Json
      }
      helper_accept_block_reason: {
        Args: { p_user_id: string }
        Returns: string
      }
      helper_accept_missing: { Args: { p_user_id: string }; Returns: string[] }
      helper_award_block_reason: {
        Args: { p_user_id: string }
        Returns: string
      }
      helper_cancel_booking: { Args: { p_job_id: string }; Returns: Json }
      helper_credential_document_ok: {
        Args: { p_path: string; p_type: string; p_user_id: string }
        Returns: boolean
      }
      helper_has_advanced_analytics: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      helper_mark_on_the_way: {
        Args: { p_job_id: string; p_lat?: number; p_lng?: number }
        Returns: string
      }
      helpr_booking_clashes: {
        Args: { p_helper_id: string }
        Returns: {
          job_id: string
          other_job_id: string
        }[]
      }
      helpr_flat_fee_cents: {
        Args: { p_flat_cents: number; p_percent: number; p_share_cents: number }
        Returns: number
      }
      helpr_go_online: { Args: { p_hours: number; p_lat: number; p_lng: number; p_on: boolean; p_radius_miles: number }; Returns: Json }
      helpr_my_route: { Args: { p_lat: number; p_lng: number }; Returns: Json }
      helpr_my_tasks: {
        Args: never
        Returns: {
          dropoff_area: string
          ended_at: string | null
          payout_status: string | null
          pickup_area: string
          pickup_slot_start: string | null
          size: string
          status: string
          take_home_cents: number
          task_id: string
          title: string
          trip_miles: number
        }[]
      }
      helpr_payout_round_down_cents: { Args: { p_cents: number }; Returns: number }
      helpr_route_cost: { Args: { p_lat: number; p_lng: number; p_now: string; p_seq: Json }; Returns: Json }
      helpr_route_leg_miles: { Args: { p_lat1: number; p_lat2: number; p_lng1: number; p_lng2: number }; Returns: number }
      helpr_route_plan: { Args: { p_lat: number; p_lng: number; p_now: string; p_stops: Json }; Returns: Json }
      helpr_route_suggestions: { Args: { p_with_task: string }; Returns: Json }
      helpr_set_vehicle: { Args: { p_has_car: boolean; p_has_truck: boolean; p_photo_path: string; p_second_person: boolean } | { p_has_truck: boolean; p_photo_path: string; p_second_person: boolean }; Returns: Json }
      helpr_task_accept: { Args: { p_pickup_slot_start: string; p_task_id: string }; Returns: Json }
      helpr_task_assert_helpr: { Args: never; Returns: string }
      helpr_task_close: { Args: { p_note: string; p_status: string; p_task: string }; Returns: string }
      helpr_task_confirm: { Args: { p_actor: string; p_by: string; p_task: string }; Returns: Json }
      helpr_task_create: { Args: { p_customer: string; p_dropoff_address: string; p_dropoff_area: string; p_dropoff_lat: number; p_dropoff_lng: number; p_is_seed: boolean; p_kind: string; p_latest_pickup: string; p_open_until: string; p_pay_cents: number; p_pickup_address: string; p_pickup_area: string; p_pickup_contact: string; p_pickup_lat: number; p_pickup_lng: number; p_size: string; p_source: string; p_title: string; p_trip_miles: number }; Returns: string }
      helpr_task_customer_confirm: { Args: { p_task_id: string }; Returns: Json }
      helpr_task_delivered: { Args: { p_code: string; p_lat: number; p_lng: number; p_photo_path: string; p_task_id: string }; Returns: Json }
      helpr_task_distance_m: { Args: { p_lat1: number; p_lat2: number; p_lng1: number; p_lng2: number }; Returns: number }
      helpr_task_dropoff_shows_at: { Args: { p_helpr: string; p_slot: string; p_status: string }; Returns: string }
      helpr_task_fee_cents: { Args: { p_pay_cents: number }; Returns: number }
      helpr_task_handed_over: { Args: { p_task_id: string }; Returns: Json }
      helpr_task_cant_finish: { Args: { p_note: string; p_reason: string; p_task_id: string }; Returns: Json }
      helpr_task_buyer_fix: { Args: { p_address: string; p_lat: number; p_lng: number; p_note: string; p_task_id: string }; Returns: Json }
      helpr_task_buyer_choose: { Args: { p_choice: string; p_note: string; p_task_id: string }; Returns: Json }
      helpr_task_returned: { Args: { p_lat: number; p_lng: number; p_photo_path: string; p_task_id: string }; Returns: Json }
      helpr_task_seller_return_answer: { Args: { p_back: boolean; p_note: string; p_task_id: string }; Returns: Json }
      declutter_admin_decide_stuck_delivery: { Args: { p_fault: string; p_note: string; p_problem_id: string }; Returns: Json }
      declutter_delivery_return_finish: { Args: { p_task: string }; Returns: Json }
      helpr_task_items: { Args: { p_kind: string; p_source: string }; Returns: Json }
      helpr_task_give_job_strike: { Args: { p_description: string; p_task: string; p_type: string; p_user: string }; Returns: Json }
      helpr_task_lock: { Args: { p_task: string }; Returns: unknown }
      helpr_task_no_show_report: { Args: { p_task_id: string }; Returns: Json }
      helpr_task_log: { Args: { p_actor: string; p_detail: string; p_kind: string; p_task: string }; Returns: undefined }
      helpr_task_payout_executed: { Args: { p_error: string; p_payout_id: string; p_succeeded: boolean; p_transfer_id: string }; Returns: string }
      helpr_task_payout_take_setup_fee: {
        Args: { p_payout_id: string }
        Returns: number
      }
      helpr_task_payouts_due: { Args: { p_limit: number }; Returns: unknown }
      helpr_task_photo_access: { Args: { p_name: string; p_write: boolean }; Returns: boolean }
      helpr_task_photo_ok: { Args: { p_path: string; p_task: string; p_uid: string }; Returns: boolean }
      helpr_task_same_pickup_slot: { Args: { p_task_id: string }; Returns: string }
      helpr_task_seller_move_pickup: { Args: { p_pickup_slot_start: string; p_task_id: string }; Returns: Json }
      helpr_task_pickup_windows: {
        Args: { p_task_id: string }
        Returns: {
          ends: string
          latest_pickup_at: string
          starts: string
          weekday: number
        }[]
      }
      helpr_task_picked_up: { Args: { p_lat: number; p_lng: number; p_photo_path: string; p_task_id: string }; Returns: Json }
      helpr_task_pickup_no_show: {
        Args: { p_lat: number; p_lng: number; p_photo_path: string; p_task_id: string }
        Returns: Json
      }
      helpr_task_release: { Args: { p_task_id: string }; Returns: Json }
      helpr_task_reopen: { Args: { p_actor: string; p_kind: string; p_note: string; p_task: string }; Returns: undefined }
      helpr_task_same_stripe_mode: { Args: { p_a: string; p_b: string }; Returns: boolean }
      helpr_task_source_event: { Args: { p_by: string; p_event: string; p_task: string }; Returns: Json }
      helpr_task_source_held: { Args: { p_kind: string; p_source: string }; Returns: boolean }
      helpr_task_source_require_feature: { Args: { p_kind: string }; Returns: undefined }
      helpr_task_source_slot_ok: { Args: { p_kind: string; p_source: string; p_start: string }; Returns: boolean }
      helpr_task_sweep: { Args: never; Returns: Json }
      helpr_task_tip_attach: { Args: { p_session_id: string; p_tip_id: string }; Returns: boolean }
      helpr_task_tip_paid: {
        Args: { p_charged_cents: number; p_payment_intent_id: string; p_session_id: string; p_tip_id: string }
        Returns: Json
      }
      helpr_task_tip_payout_sent: { Args: { p_tip_id: string; p_transfer_id: string }; Returns: string }
      helpr_task_tip_start: { Args: { p_attempt_id: string; p_task_id: string; p_tip_cents: number }; Returns: Json }
      helpr_task_tips_stranded: {
        Args: never
        Returns: {
          helpr_id: string
          payment_intent_id: string
          payout_status: string
          task_id: string
          tip_cents: number
          tip_id: string
        }[]
      }
      helpr_task_vehicle_fits: { Args: { p_size: string; p_user: string }; Returns: boolean }
      helpr_task_view: { Args: { p_task_id: string }; Returns: Json }
      helpr_tasks_open_count: {
        Args: never
        Returns: {
          open_count: number
          pickup_area: string
        }[]
      }
      helpr_tasks_open_near: {
        Args: { p_lat: number; p_limit: number; p_lng: number }
        Returns: {
          dropoff_area: string
          latest_pickup_at: string
          miles_to_pickup: number | null
          open_until: string
          pickup_area: string
          size: string
          source_kind: string
          take_home_cents: number
          task_id: string
          title: string
          trip_miles: number
        }[]
      }
      hook_one_account_per_person: { Args: { event: Json }; Returns: Json }
      identity_notify_posters_before_start: {
        Args: { p_limit?: number }
        Returns: number
      }
      identity_fingerprint: {
        Args: {
          p_dob: string
          p_doc_number?: string
          p_first_name: string
          p_last_name: string
        }
        Returns: string
      }
      identity_is_verified: {
        Args: { p_idv_status: string; p_stripe_identity_verified: boolean }
        Returns: boolean
      }
      is_caller_banned: { Args: never; Returns: boolean }
      is_category_taxable: {
        Args: { _category: Database["public"]["Enums"]["job_category"] }
        Returns: boolean
      }
      is_crew_member_of_job_folder: {
        Args: { object_name: string }
        Returns: boolean
      }
      is_fixture_email: { Args: { p_email: string }; Returns: boolean }
      is_helper_shadowbanned: { Args: { _helper_id: string }; Returns: boolean }
      is_identity_verified: { Args: { p_user_id: string }; Returns: boolean }
      identity_check_exempt: { Args: { p_user_id: string }; Returns: boolean }
      idv_review_waiting_since: { Args: { p_user_id: string }; Returns: string }
      is_late_cancellation: {
        Args: { p_has_helper: boolean; p_hours_until: number }
        Returns: boolean
      }
      is_off_job: { Args: { _job_id: string; _user: string }; Returns: boolean }
      is_party_to_job: {
        Args: { _job_id: string; _user_id: string }
        Returns: boolean
      }
      is_party_to_job_folder: {
        Args: { object_name: string }
        Returns: boolean
      }
      is_safe_media_url: { Args: { v: string }; Returns: boolean }
      is_seed_email: { Args: { p_email: string }; Returns: boolean }
      is_series_party: { Args: { p_parent: string }; Returns: boolean }
      is_server_context: { Args: never; Returns: boolean }
      is_submitted_credential_object: {
        Args: { p_name: string }
        Returns: boolean
      }
      is_test_member: { Args: { p_user_id: string }; Returns: boolean }
      is_test_subject: { Args: { p_user_id: string }; Returns: boolean }
      is_thread_muted: {
        Args: { _job_id: string; _other_user_id: string; _user: string }
        Returns: boolean
      }
      is_user_error_screen_row: { Args: { p_tags: Json }; Returns: boolean }
      job_announceable_to: {
        Args: {
          p_job: Database["public"]["Tables"]["jobs"]["Row"]
          p_user_id: string
        }
        Returns: boolean
      }
      job_category_group: {
        Args: { p_category: Database["public"]["Enums"]["job_category"] }
        Returns: string
      }
      job_expires_at_for_schedule: {
        Args: { p_date_needed: string; p_start_time: string }
        Returns: string
      }
      job_booked_helpr_ids: { Args: { p_job_id: string }; Returns: string[] }
      job_has_crew: { Args: { p_job: string }; Returns: boolean }
      job_hours_until_start: {
        Args: { p_at: string; p_date_needed: string; p_start_time: string }
        Returns: number
      }
      job_is_funded: { Args: { p_job_id: string }; Returns: boolean }
      job_legacy_completed_at: {
        Args: {
          _helper_completed_at: string
          _poster_completed_at: string
          _revision_completed_at: string
          _updated_at: string
        }
        Returns: string
      }
      job_messaging_closes_at: { Args: { _job_id: string }; Returns: string }
      job_payment_is_funded: {
        Args: { p_payment_status: string }
        Returns: boolean
      }
      job_payment_is_listed: {
        Args: { p_payment_status: string }
        Returns: boolean
      }
      job_photos_shareable: { Args: { p_job_id: string }; Returns: boolean }
      job_posted_by_seed: {
        Args: { p_customer_id: string }
        Returns: boolean
      }
      jobs_private_select_columns: { Args: never; Returns: string[] }
      kick_payout_schedule_sync: {
        Args: { p_helper_id: string }
        Returns: boolean
      }
      landlord_id_images_deleted: {
        Args: { p_reviewed_at: string; p_user_id: string }
        Returns: boolean
      }
      landlord_id_images_due: {
        Args: { p_limit?: number; p_retention_days: number }
        Returns: {
          reviewed_at: string
          user_id: string
        }[]
      }
      lift_ban_settlement_review: {
        Args: { p_admin_id: string; p_ban_status?: string; p_user_id: string }
        Returns: Json
      }
      link_maintenance_request_job: {
        Args: { p_job_id: string; p_request_id: string }
        Returns: boolean
      }
      link_str_turnover_job: {
        Args: { p_event_id: string; p_job_id: string }
        Returns: boolean
      }
      list_open_quote_requests: {
        Args: never
        Returns: {
          category: string
          created_at: string
          date_needed: string
          description: string
          estimated_hours: number
          id: string
          latitude: number
          location: string
          longitude: number
          my_quote_id: string
          my_quote_status: string
          parish: string
          quotes_close_at: string
          start_time: string
          title: string
        }[]
      }
      log_cron_defect: {
        Args: { p_context?: Json; p_err: string; p_fn: string; p_ref: string }
        Returns: undefined
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
      log_push_notification: {
        Args: {
          _category: string
          _error?: string
          _job_id?: string
          _status: string
          _subject?: string
          _user_id: string
        }
        Returns: string
      }
      mark_applications_viewed: {
        Args: { p_job_id: string }
        Returns: undefined
      }
      mark_crew_dispute_executed: {
        Args: {
          _dispute_id: string
          _helper_cents: number
          _refund_cents: number
          _refund_id: string
        }
        Returns: boolean
      }
      mark_helper_arrival: {
        Args: { p_job_id: string; p_lat?: number; p_lng?: number }
        Returns: Json
      }
      marketing_published_today: {
        Args: { p_channel: Database["public"]["Enums"]["marketing_channel"] }
        Returns: number
      }
      mask_job_location: { Args: { loc: string }; Returns: string }
      member_display_name: {
        Args: { p_fallback?: string; p_full_name: string }
        Returns: string
      }
      member_under_18: { Args: { p_user_id: string }; Returns: boolean }
      message_attachment_locked: { Args: { p_name: string }; Returns: boolean }
      message_delete_locked: {
        Args: { p_job_id: string; p_message_id: string }
        Returns: boolean
      }
      message_violation_ladder: {
        Args: {
          p_content: string
          p_description: string
          p_message_saved: boolean
        }
        Returns: Json
      }
      miles_between: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      money_ref_in_use: { Args: { p_ref: string }; Returns: boolean }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      my_credential_tier: { Args: never; Returns: number }
      my_schedule_clashes: {
        Args: never
        Returns: {
          job_id: string
          other_date: string
          other_job_id: string
          other_start_time: string
          other_title: string
        }[]
      }
      normalize_name_for_ban: { Args: { p_name: string }; Returns: string }
      normalize_phone7_for_ban: { Args: { p_phone: string }; Returns: string }
      normalize_phone_for_ban: { Args: { p_phone: string }; Returns: string }
      note_failed_fee_transfer: {
        Args: { p_kind: string; p_reason: string; p_row: string; p_transfer: string }
        Returns: string
      }
      daily_member_summary_message: {
        Args: { p_deleted: number; p_ids: string[] }
        Returns: string
      }
      new_member_summary_message: { Args: { p_ids: string[] }; Returns: string }
      notification_admin_full_names: {
        Args: {
          p_job_id: string
          p_link: string
          p_message: string
          p_recipient: string
          p_title: string
        }
        Returns: {
          message: string
          title: string
        }[]
      }
      notification_crosses_seed_boundary: {
        Args: {
          p_actor?: string
          p_job_id: string
          p_link: string
          p_recipient: string
        }
        Returns: boolean
      }
      notification_job_id_from_link: {
        Args: { p_link: string }
        Returns: string
      }
      notify_admins_new_member: {
        Args: { p_user_id: string; p_via?: string }
        Returns: string
      }
      notify_schedule_change_expired: {
        Args: { p_reason: string; p_request_id: string }
        Returns: undefined
      }
      notify_ops_dispute_filed: {
        Args: {
          _job_id: string
          _job_title: string
          _opener_id: string
          _reason: string
          _refiled?: boolean
        }
        Returns: undefined
      }
      nudge_confirm: {
        Args: { p_job_id: string }
        Returns: string
      }
      offer_series_dates: {
        Args: { p_helper_id: string; p_job_id: string }
        Returns: Json
      }
      open_dispute_as: {
        Args: {
          _evidence_urls: string[]
          _job_id: string
          _opener_id: string
          _reason: string
        }
        Returns: string
      }
      ops_alert_apply: {
        Args: {
          p_sample?: string
          p_sample_ref?: Json
          p_seen_at?: string
          p_severity: string
          p_source: string
          p_source_kind: string
          p_title: string
          p_verify_kind?: string
          p_verify_ref?: string
        }
        Returns: string
      }
      ops_alert_close: {
        Args: { p_evidence: string; p_id: string; p_rerun_started_at: string }
        Returns: boolean
      }
      ops_alert_condition: {
        Args: {
          p_probe_only?: boolean
          p_sample_ref: Json
          p_since: string
          p_source: string
        }
        Returns: boolean
      }
      ops_alert_fingerprint: {
        Args: {
          p_job?: string
          p_source: string
          p_source_kind: string
          p_title: string
        }
        Returns: string
      }
      ops_alert_fold_pending: { Args: never; Returns: number }
      ops_alert_mark_fixed: {
        Args: { p_id: string; p_note: string }
        Returns: boolean
      }
      ops_alert_normalise: { Args: { p_text: string }; Returns: string }
      ops_alert_record: {
        Args: {
          p_sample?: string
          p_sample_ref?: Json
          p_seen_at?: string
          p_severity: string
          p_source: string
          p_source_kind: string
          p_title: string
          p_verify_kind?: string
          p_verify_ref?: string
        }
        Returns: string
      }
      ops_alert_record_user_error_screen: {
        Args: {
          p_error_log_id: string
          p_message: string
          p_seen_at?: string
          p_tags: Json
          p_user_id: string
        }
        Returns: string
      }
      ops_alert_record_user_report: {
        Args: { p_report_id: string }
        Returns: string
      }
      ops_alert_sentry_source: { Args: { p_source: string }; Returns: string }
      ops_alert_verify: { Args: never; Returns: Json }
      ops_route_key: { Args: { p_route: string }; Returns: string }
      owner_daily_summary_stats: { Args: { p_since: string }; Returns: Json }
      payout_day_label: { Args: { p_at: string }; Returns: string }
      payout_defer: {
        Args: { p_kind: string; p_minutes: number; p_payout_id: string }
        Returns: undefined
      }
      payout_held_check: { Args: never; Returns: number }
      payout_hold_for_review: {
        Args: {
          p_category: string
          p_id: string
          p_kind: string
          p_reason: string
        }
        Returns: boolean
      }
      payout_mark_sending: {
        Args: { p_kind: string; p_payout_id: string }
        Returns: undefined
      }
      payout_payee_paged: {
        Args: { p_category: string; p_kind: string; p_payout_id: string }
        Returns: undefined
      }
      payout_payee_wait_cleared: {
        Args: { p_kind: string; p_payout_id: string }
        Returns: undefined
      }
      payout_payee_wait_seen: {
        Args: {
          p_amount_cents: number
          p_category: string
          p_kind: string
          p_payee: string
          p_payout_id: string
          p_reason: string
        }
        Returns: Json
      }
      payout_payee_waits_prune: { Args: never; Returns: number }
      payout_send_marks_for: {
        Args: { p_ids: string[]; p_kind: string }
        Returns: string[]
      }
      payout_setup_hire_allowed: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      payout_setup_hire_allowed_for_me: { Args: never; Returns: boolean }
      payout_waits_on_identity: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      poster_cancel_job: {
        Args: { p_expected_fee_cents?: number; p_job_id: string; p_reason?: string }
        Returns: Json
      }
      poster_crew_block_fee_cents: {
        Args: never
        Returns: {
          fee_cents: number
          job_id: string
        }[]
      }
      pre_verification_wipe_objects: {
        Args: { p_wipe_id: string }
        Returns: {
          bucket: string
          name: string
        }[]
      }
      process_referral: {
        Args: { p_new_user_id: string; p_referral_code: string }
        Returns: boolean
      }
      profiles_locked_update_columns: { Args: never; Returns: string[] }
      prune_cron_http_requests: { Args: never; Returns: number }
      prune_cron_run_details: { Args: never; Returns: number }
      prune_cron_run_log: { Args: never; Returns: number }
      prune_edge_rate_limit_log: { Args: never; Returns: Json }
      prune_retention_tables: { Args: never; Returns: Json }
      purge_old_seed_data: {
        Args: { p_batch?: number; p_dry_run?: boolean; p_older_than?: string }
        Returns: Json
      }
      purge_user_data: { Args: { p_user_id: string }; Returns: Json }
      quote_display_status: {
        Args: { p_respond_until: string; p_status: string }
        Returns: string
      }
      quote_insert_job: {
        Args: {
          p_budget: number
          p_offer_to: string
          p_req: Database["public"]["Tables"]["job_quote_requests"]["Row"]
        }
        Returns: string
      }
      quote_job_offered_to_quoter: {
        Args: { p_helper: string; p_job_id: string }
        Returns: boolean
      }
      quote_notify_to: {
        Args: {
          p_actor: string
          p_email: boolean
          p_email_type?: string
          p_job_id: string
          p_message: string
          p_payout_setup: boolean
          p_request_id: string
          p_title: string
          p_user: string
        }
        Returns: undefined
      }
      quote_require_member: { Args: never; Returns: string }
      rate_limit_hit: {
        Args: {
          p_bucket: string
          p_forwarded_for?: string
          p_ip: string
          p_ip_max: number
          p_max: number
          p_subject: string
          p_window_seconds: number
        }
        Returns: Json
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      reap_stranded_instant_payouts: { Args: never; Returns: Json }
      record_booking_source: { Args: { p_helpr_id: string }; Returns: string }
      record_error_log_throttle_drop: {
        Args: { p_kind: string }
        Returns: undefined
      }
      record_job_view: { Args: { p_job_id: string }; Returns: string }
      record_my_signup_source: {
        Args: { p_campaign?: string; p_source: string }
        Returns: boolean
      }
      record_profile_view: {
        Args: { p_viewed_user_id: string }
        Returns: boolean
      }
      record_referral_signup: {
        Args: { p_new_user_id: string; p_referral_code: string }
        Returns: boolean
      }
      record_route_probe_passes: {
        Args: { p_routes: string[]; p_run_ref?: string }
        Returns: number
      }
      record_signup_lead: {
        Args: { p_email: string; p_replaces?: string; p_source?: string }
        Returns: undefined
      }
      redact_audit_snapshot: { Args: { p_row: Json }; Returns: Json }
      register_push_subscription: {
        Args: {
          p_auth: string
          p_endpoint: string
          p_p256dh: string
          p_user_agent: string
        }
        Returns: string
      }
      redeem_gift_card: {
        Args: {
          p_credit_id: string
          p_job_id: string
          p_retired_session?: string
          p_user_id: string
        }
        Returns: Json
      }
      refund_agreement_for_dispute: {
        Args: { p_dispute_id: string }
        Returns: Json
      }
      refund_agreements_due: {
        Args: { p_limit?: number }
        Returns: {
          dispute_id: string
          job_id: string
          request_id: string
        }[]
      }
      refund_come_back_pending: { Args: { p_job_id: string }; Returns: boolean }
      refund_party_held: { Args: { p_user: string }; Returns: boolean }
      refund_monthly_free_boost: {
        Args: { p_month: string; p_user_id: string }
        Returns: boolean
      }
      refund_request_assert_job_open: {
        Args: { p_job_id: string }
        Returns: undefined
      }
      refund_request_dollars: { Args: { p_cents: number }; Returns: string }
      refund_request_is_live: {
        Args: { p_dispute_id: string; p_status: string }
        Returns: boolean
      }
      refund_request_rush_back_cents: {
        Args: { p_asked_cents: number; p_price_cents: number; p_rush_cents: number }
        Returns: number
      }
      refund_requests_sweep: { Args: never; Returns: Json }
      release_dispute_settlement_claim: {
        Args: { _job_id: string; _token?: string }
        Returns: boolean
      }
      rentals_accept_invite: {
        Args: { p_token: string }
        Returns: string
      }
      rentals_add_listing_photo: {
        Args: { p_listing_id: string; p_storage_path: string }
        Returns: string
      }
      rentals_add_rent_payment: {
        Args: {
          p_amount_cents: number
          p_method: string
          p_paid_on: string
          p_tenancy_id: string
        }
        Returns: string
      }
      rentals_add_unit: {
        Args: { p_label: string; p_property_id: string }
        Returns: string
      }
      rentals_address_key: { Args: { p_street: string; p_zip: string }; Returns: string }
      rentals_admin_review_landlord_id: {
        Args: {
          p_approve: boolean
          p_note: string
          p_submitted_at: string
          p_user_id: string
        }
        Returns: undefined
      }
      rentals_admin_review_property: {
        Args: { p_approve: boolean; p_note: string; p_property_id: string }
        Returns: undefined
      }
      rentals_admin_lift_takedown: {
        Args: { p_note: string; p_property_id: string }
        Returns: undefined
      }
      rentals_admin_listings: {
        Args: { p_open_offset?: number; p_query?: string; p_taken_offset?: number }
        Returns: Json
      }
      rentals_admin_remove_listing: {
        Args: { p_listing_id: string; p_reason: string }
        Returns: undefined
      }
      rentals_admin_takedown_matches: {
        Args: { p_property_ids: string[] }
        Returns: Json
      }
      rentals_approve_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      rentals_assert_member: { Args: never; Returns: string }
      rentals_browse_sale_listings: {
        Args: {
          p_city?: string
          p_limit?: number
          p_max_price_cents?: number
          p_min_beds?: number
          p_offset?: number
        }
        Returns: {
          baths: number
          beds: number
          city: string
          headline: string
          id: string
          is_mine: boolean
          photo_refs: string[]
          published_at: string
          sale_price_cents: number
          sq_ft: number
          zip_code: string
        }[]
      }
      rentals_caller_is_active_tenant_of: {
        Args: { p_property_id: string }
        Returns: boolean
      }
      rentals_browse_listings: {
        Args: {
          p_city?: string
          p_limit?: number
          p_max_rent_cents?: number
          p_min_beds?: number
          p_offset?: number
        }
        Returns: {
          available_on: string
          baths: number
          beds: number
          city: string
          headline: string
          id: string
          is_mine: boolean
          pets: string
          photo_refs: string[]
          published_at: string
          rent_cents: number
          rent_frequency: string
          sq_ft: number
          zip_code: string
        }[]
      }
      rentals_correct_rent_payment: {
        Args: {
          p_action: string
          p_amount_cents: number | null
          p_paid_on: string | null
          p_payment_id: string
          p_reason: string
        }
        Returns: undefined
      }
      rentals_create_property: {
        Args: {
          p_city: string
          p_label: string
          p_street_address: string
          p_zip_code: string
        }
        Returns: string
      }
      rentals_decide_rent_payment: {
        Args: { p_payment_id: string; p_reason?: string; p_received: boolean }
        Returns: undefined
      }
      rentals_decline_request: {
        Args: {
          p_reason_code: string
          p_reason_text: string
          p_request_id: string
        }
        Returns: undefined
      }
      rentals_deposit: {
        Args: { p_tenancy_id: string }
        Returns: Json
      }
      rentals_deposit_sweep: { Args: never; Returns: Json }
      rentals_dispute_rent_payment: {
        Args: { p_payment_id: string; p_reason: string }
        Returns: undefined
      }
      rentals_end_tenancy: {
        Args: { p_tenancy_id: string }
        Returns: undefined
      }
      rentals_file_request: {
        Args: {
          p_access_notes: string
          p_access_windows: string
          p_category: string
          p_description: string
          p_ok_to_enter_alone: boolean
          p_pets_on_site: boolean
          p_photo_paths: string[]
          p_tenancy_id: string
          p_urgency: string
        }
        Returns: string
      }
      rentals_invite_tenant: {
        Args: { p_unit_id: string }
        Returns: string
      }
      rentals_lease: { Args: { p_tenancy_id: string }; Returns: Json }
      rentals_lease_blanks_sha256: {
        Args: { p_fields: Json; p_version: string }
        Returns: string
      }
      rentals_lease_discard: { Args: { p_lease_id: string }; Returns: undefined }
      rentals_lease_for_action: {
        Args: { p_lease_id: string; p_side: string; p_status: string }
        Returns: {
          blanks_sha256: string | null
          body_sha256: string | null
          change_request: string | null
          created_at: string
          fields: Json
          home_label: string | null
          id: string
          landlord_consent_at: string | null
          landlord_id: string | null
          landlord_initials: string[]
          landlord_signed_at: string | null
          landlord_signed_name: string | null
          sent_at: string | null
          status: string
          template_version: string
          tenancy_id: string | null
          tenant_consent_at: string | null
          tenant_id: string | null
          tenant_initials: string[]
          tenant_signed_at: string | null
          tenant_signed_name: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "rental_leases"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rentals_lease_initial_keys: { Args: { p_fields: Json }; Returns: string[] }
      rentals_lease_missing: {
        Args: { p_fields: Json; p_version: string }
        Returns: string[]
      }
      rentals_lease_request_changes: {
        Args: { p_lease_id: string; p_note: string }
        Returns: undefined
      }
      rentals_lease_save: {
        Args: { p_fields: Json; p_template_version: string; p_tenancy_id: string }
        Returns: string
      }
      rentals_lease_send: {
        Args: {
          p_body_sha256: string
          p_consent: boolean
          p_fields: Json
          p_initials: string[]
          p_lease_id: string
          p_signed_name: string
          p_template_version: string
        }
        Returns: undefined
      }
      rentals_lease_sign: {
        Args: {
          p_body_sha256: string
          p_consent: boolean
          p_initials: string[]
          p_lease_id: string
          p_sent_at: string
          p_signed_name: string
        }
        Returns: undefined
      }
      rentals_lease_signature: { Args: { p_name: string }; Returns: string }
      rentals_lease_signed_json: {
        Args: {
          l: Database["public"]["Tables"]["rental_leases"]["Row"]
          p_uid: string
        }
        Returns: Json
      }
      rentals_lease_withdraw: { Args: { p_lease_id: string }; Returns: undefined }
      rentals_listing: {
        Args: { p_listing_id: string }
        Returns: {
          accepts_vouchers: string
          accessibility: string[]
          available_on: string
          baths: number
          beds: number
          city: string
          deposit_cents: number
          description: string
          expires_at: string
          headline: string
          id: string
          is_mine: boolean
          kind: string
          lease_months_max: number
          lease_months_min: number
          lot_sq_ft: number
          parking: string
          pet_rules: string
          pets: string
          photo_refs: string[]
          published_at: string
          rent_cents: number
          rent_frequency: string
          sale_price_cents: number
          sq_ft: number
          status: string
          utilities_included: string[]
          year_built: number
          zip_code: string
        }[]
      }
      rentals_listing_photo_access: {
        Args: { p_action: string; p_name: string }
        Returns: boolean
      }
      rentals_listing_photo_deletable: { Args: { p_name: string }; Returns: boolean }
      rentals_listing_photo_object: { Args: { p_ref: string }; Returns: string }
      rentals_listing_visible: {
        Args: { p_listing_id: string }
        Returns: boolean
      }
      rentals_listing_wording_flags: {
        Args: { p_text: string }
        Returns: string[]
      }
      rentals_lock_own_listing: {
        Args: { p_listing_id: string; p_uid: string }
        Returns: {
          accepts_vouchers: string
          accessibility: string[]
          available_on: string | null
          baths: number
          beds: number
          created_at: string
          deposit_cents: number | null
          description: string
          expires_at: string | null
          headline: string
          id: string
          kind: string
          lease_months_max: number | null
          lease_months_min: number | null
          lot_sq_ft: number | null
          owner_id: string
          parking: string
          pet_rules: string
          pets: string
          property_id: string
          published_at: string | null
          rent_cents: number | null
          rent_frequency: string
          sale_price_cents: number | null
          slug: string
          sq_ft: number | null
          status: string
          unit_id: string | null
          updated_at: string
          utilities_included: string[]
          wording_flags: string[]
          year_built: number | null
        }
        SetofOptions: {
          from: "*"
          to: "rental_listings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rentals_my_ended_deposits: {
        Args: never
        Returns: {
          label: string
          settled: boolean
          side: string
          tenancy_id: string
          unit_label: string
        }[]
      }
      rentals_my_homes: {
        Args: never
        Returns: {
          city: string
          label: string
          property_id: string
          street_address: string
          tenancy_id: string
          unit_id: string
          unit_label: string
          zip_code: string
        }[]
      }
      rentals_my_leases: { Args: never; Returns: Json }
      rentals_my_listing_photos: {
        Args: { p_listing_id: string }
        Returns: {
          id: string
          position: number
          ref: string
        }[]
      }
      rentals_my_identity: {
        Args: never
        Returns: {
          id_status: string
          review_note: string
          reviewed_at: string
          submitted_at: string
          verified: boolean
        }[]
      }
      rentals_notify: {
        Args: {
          p_email: boolean
          p_link: string
          p_message: string
          p_staff?: boolean
          p_title: string
          p_user: string
        }
        Returns: undefined
      }
      rentals_photo_path_listing: { Args: { p_path: string }; Returns: string }
      rentals_photo_purge_done: { Args: { p_bucket: string; p_paths: string[] }; Returns: number }
      rentals_photo_purge_due: {
        Args: { p_limit?: number }
        Returns: {
          bucket_id: string
          storage_path: string
        }[]
      }
      rentals_photo_ref: { Args: { p_photo_id: string; p_scope: string }; Returns: string }
      rentals_photo_sig: { Args: { p_msg: string }; Returns: string }
      rentals_public_listing: {
        Args: { p_slug: string }
        Returns: {
          accepts_vouchers: string
          accessibility: string[]
          available_on: string
          baths: number
          beds: number
          city: string
          deposit_cents: number
          description: string
          headline: string
          kind: string
          lease_months_max: number
          lease_months_min: number
          lot_sq_ft: number
          parking: string
          pet_rules: string
          pets: string
          photo_refs: string[]
          published_at: string
          rent_cents: number
          rent_frequency: string
          sale_price_cents: number
          sq_ft: number
          utilities_included: string[]
          year_built: number
          zip_code: string
        }[]
      }
      rentals_public_listing_visible: { Args: { p_listing_id: string }; Returns: boolean }
      rentals_remove_listing_photo: {
        Args: { p_photo_id: string }
        Returns: string
      }
      rentals_rent_ledger: {
        Args: { p_tenancy_id: string }
        Returns: Json
      }
      rentals_rent_next_due: {
        Args: { p_first: string; p_frequency: string; p_on_or_after: string }
        Returns: string
      }
      rentals_rent_side: { Args: { p_tenancy_id: string; p_uid: string }; Returns: string }
      rentals_rent_sweep: { Args: never; Returns: Json }
      rentals_request_job_state: {
        Args: { p_request_id: string }
        Returns: {
          booking: string
          job_id: string
          job_status: string
        }[]
      }
      rentals_save_listing: {
        Args: { p_fields: Json; p_listing_id: string; p_unit_id: string }
        Returns: string
      }
      rentals_save_sale_listing: {
        Args: { p_fields: Json; p_listing_id: string; p_property_id: string }
        Returns: string
      }
      rentals_saved_listings: {
        Args: never
        Returns: {
          available_on: string
          baths: number
          beds: number
          city: string
          headline: string
          id: string
          kind: string
          photo_refs: string[]
          rent_cents: number
          rent_frequency: string
          sale_price_cents: number
          saved_at: string
          sq_ft: number
          zip_code: string
        }[]
      }
      rentals_set_auto_approve: {
        Args: { p_limit_cents: number; p_property_id: string }
        Returns: undefined
      }
      rentals_set_deposit: {
        Args: { p_amount_cents: number; p_received_on: string; p_tenancy_id: string }
        Returns: undefined
      }
      rentals_set_forwarding_address: {
        Args: { p_address: string; p_tenancy_id: string }
        Returns: undefined
      }
      rentals_set_listing_status: {
        Args: { p_listing_id: string; p_status: string }
        Returns: undefined
      }
      rentals_set_saved_home: {
        Args: { p_listing_id: string; p_saved: boolean }
        Returns: boolean
      }
      rentals_set_rent_plan: {
        Args: { p_fields: Json; p_tenancy_id: string }
        Returns: undefined
      }
      rentals_settle_deposit: {
        Args: {
          p_deductions: Json
          p_returned_cents: number
          p_returned_on: string
          p_tenancy_id: string
        }
        Returns: undefined
      }
      rentals_submit_landlord_id: {
        Args: { p_back_path: string; p_front_path: string }
        Returns: undefined
      }
      rentals_submit_ownership_proof: {
        Args: { p_property_id: string; p_storage_path: string }
        Returns: undefined
      }
      rentals_cancel_request_job: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      rentals_confirm_visit: {
        Args: { p_at: string; p_request_id: string }
        Returns: undefined
      }
      rentals_propose_visit: {
        Args: { p_at: string; p_job_id: string }
        Returns: undefined
      }
      rentals_tenancy_party: { Args: { p_tenancy_id: string }; Returns: boolean }
      rentals_tenant_answer_fixed: {
        Args: { p_fixed: boolean; p_note: string; p_request_id: string }
        Returns: undefined
      }
      rentals_visit_for_job: {
        Args: { p_job_id: string }
        Returns: {
          confirmed_at: string
          proposed_for: string
          request_id: string
        }[]
      }
      rentals_waive_rent_charge: {
        Args: { p_charge_id: string }
        Returns: undefined
      }
      rentals_withdraw_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      report_helper_no_show: { Args: { p_job_id: string }; Returns: Json }
      report_stale_dispute_settlement_claim: {
        Args: {
          _action: string
          _claimed_at: string
          _claimed_by: string
          _found_by: string
          _job_id: string
          _money_step_at: string
          _token: string
        }
        Returns: boolean
      }
      request_job_detail_change: {
        Args: { p_changes: Json; p_job_id: string }
        Returns: Json
      }
      request_job_schedule_change: {
        Args: { p_date: string; p_job_id: string; p_start_time: string }
        Returns: Json
      }
      require_feature: { Args: { p_key: string }; Returns: undefined }
      resolve_approval_escalation: {
        Args: { p_job_id: string }
        Returns: boolean
      }
      resolve_auto_tip: {
        Args: { _budget: number; _user: string }
        Returns: number
      }
      resolve_stalled_job_flag: { Args: { p_job_id: string }; Returns: boolean }
      respond_job_detail_change: {
        Args: { p_accept: boolean; p_request_id: string }
        Returns: Json
      }
      respond_job_schedule_change: {
        Args: { p_accept: boolean; p_request_id: string }
        Returns: Json
      }
      respond_to_direct_offer: {
        Args: { p_accept: boolean; p_job_id: string }
        Returns: Json
      }
      respond_to_job_quote: {
        Args: {
          p_action: string
          p_note?: string
          p_price_cents?: number
          p_quote_id: string
        }
        Returns: string
      }
      respond_to_review: {
        Args: { _response_text: string; _review_id: string }
        Returns: undefined
      }
      restore_gift_card_for_job: {
        Args: { p_dry_run?: boolean; p_job_id: string; p_share_bps?: number }
        Returns: Json
      }
      restore_helpr_fault_fee: {
        Args: { p_helper_id: string; p_job_id: string }
        Returns: number
      }
      retain_ban_for_user: {
        Args: { p_user_id: string; p_via?: string }
        Returns: number
      }
      retain_ban_on_deletion: { Args: { p_user_id: string }; Returns: number }
      return_bounced_gift_card: {
        Args: { p_gift_card_id: string; p_job_id: string }
        Returns: Json
      }
      review_credential: {
        Args: {
          _credential: string
          _decision: string
          _expires?: string
          _reason?: string
          _user_id: string
        }
        Returns: undefined
      }
      revoke_gift_card_for_refund: {
        Args: { p_payment_intent_id: string; p_reason?: string }
        Returns: Json
      }
      rpc_add_dispute_evidence: {
        Args: { _dispute_id: string; _evidence_urls: string[] }
        Returns: string[]
      }
      rpc_answer_refund_request: {
        Args: {
          p_answer: string
          p_date?: string
          p_request_id: string
          p_start_time?: string
        }
        Returns: Json
      }
      rpc_admin_end_recurring_series: {
        Args: { p_job_id: string; p_reason: string }
        Returns: Json
      }
      rpc_check_application_rate: {
        Args: { _applicant_id: string }
        Returns: {
          allowed: boolean
          reason: string
          retry_after_seconds: number
        }[]
      }
      rpc_clear_test_mode_dispute_refund_stamp: {
        Args: { _dispute_id: string; _reason: string; _refund_id: string }
        Returns: undefined
      }
      rpc_clear_test_mode_dispute_stamp: {
        Args: { _dispute_id: string; _reason: string; _transfer_id: string }
        Returns: undefined
      }
      rpc_close_test_mode_dispute: {
        Args: { _dispute_id: string; _note: string }
        Returns: undefined
      }
      rpc_decide_crew_dispute: {
        Args: {
          _decision_text: string
          _dispute_id: string
          _refund_helper_ids: string[]
        }
        Returns: Json
      }
      rpc_decide_dispute: {
        Args: {
          _decision_text: string
          _dispute_id: string
          _payout_split: Json
        }
        Returns: undefined
      }
      rpc_escalate_dispute: { Args: { _job_id: string }; Returns: string }
      rpc_group_member_confirm: { Args: { _job_id: string }; Returns: Json }
      rpc_group_member_mark_arrival: {
        Args: { _job_id: string; p_lat?: number; p_lng?: number }
        Returns: Json
      }
      rpc_group_member_mark_done: { Args: { _job_id: string }; Returns: Json }
      rpc_group_member_on_the_way: {
        Args: { _job_id: string; p_lat?: number; p_lng?: number }
        Returns: Json
      }
      rpc_group_member_set_proof: {
        Args: { _after?: string[]; _before?: string[]; _job_id: string }
        Returns: Json
      }
      rpc_helper_mark_done: { Args: { _job_id: string }; Returns: Json }
      guarantee_claim_for_dispute: {
        Args: { p_dispute_id: string }
        Returns: Json
      }
      guarantee_close_on_lost_chargeback: {
        Args: { p_job_id: string }
        Returns: number
      }
      guarantee_escalate: {
        Args: { p_claim_id: string; p_reason: string }
        Returns: string
      }
      guarantee_rules: { Args: never; Returns: Json }
      guarantee_sweep: { Args: never; Returns: Json }
      guarantee_tell: {
        Args: {
          p_job_id: string
          p_message: string
          p_title: string
          p_to: string
        }
        Returns: undefined
      }
      rpc_guarantee_helpr_answer: {
        Args: { _accept: boolean; _claim_id: string; _fix_date?: string }
        Returns: string
      }
      rpc_guarantee_mark_fixed: {
        Args: { _claim_id: string }
        Returns: string
      }
      rpc_guarantee_open: {
        Args: { _job_id: string; _note: string; _photo_paths?: string[] }
        Returns: string
      }
      rpc_guarantee_poster_answer: {
        Args: { _claim_id: string; _fixed: boolean; _note?: string }
        Returns: string
      }
      rpc_open_dispute: {
        Args: { _evidence_urls: string[]; _job_id: string; _reason: string }
        Returns: string
      }
      rpc_open_refund_request: {
        Args: {
          p_amount_cents: number
          p_job_id: string
          p_reason: string
          p_scope: string
        }
        Returns: string
      }
      rpc_poster_confirm_member_arrival: {
        Args: { _helper_id: string; _job_id: string }
        Returns: Json
      }
      rpc_poster_report_member_no_show: {
        Args: { _job_id: string; _member_id: string }
        Returns: Json
      }
      rpc_record_application_attempt: {
        Args: { _applicant_id: string }
        Returns: undefined
      }
      rpc_settle_dispute_without_payment: {
        Args: { _dispute_id: string; _note: string }
        Returns: undefined
      }
      rpc_supersede_dispute_decision: {
        Args: { _dispute_id: string; _reason: string }
        Returns: string
      }
      rpc_withdraw_dispute: { Args: { _job_id: string }; Returns: undefined }
      rpc_withdraw_refund_request: {
        Args: { p_request_id: string }
        Returns: Json
      }
      run_missed_cron_catch_up: { Args: never; Returns: Json }
      run_seed_purge: { Args: never; Returns: Json }
      save_weekly_availability: { Args: { p_slots: Json }; Returns: number }
      saved_search_category_matches: {
        Args: {
          p_category: Database["public"]["Enums"]["job_category"]
          p_search_category: string
        }
        Returns: boolean
      }
      saved_search_new_counts: {
        Args: never
        Returns: {
          new_count: number
          search_id: string
        }[]
      }
      scanner_safe_confirm_link_for: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      search_profiles_by_name: {
        Args: { query: string }
        Returns: {
          avatar_url: string
          full_name: string
          user_id: string
        }[]
      }
      seed_hidden_for: { Args: { p_user_id: string }; Returns: boolean }
      seed_hidden_from_caller: { Args: never; Returns: boolean }
      seed_hidden_in_discovery: { Args: never; Returns: boolean }
      seed_jobs_hidden_publicly: { Args: never; Returns: boolean }
      seed_review_hidden: {
        Args: { p_job_id: string; p_reviewee_id: string; p_reviewer_id: string }
        Returns: boolean
      }
      send_application_roundups: {
        Args: { p_limit?: number }
        Returns: number
      }
      send_backout_email: {
        Args: {
          p_job: string
          p_link: string
          p_message: string
          p_title: string
          p_user: string
        }
        Returns: undefined
      }
      send_job_match_roundups: {
        Args: { p_limit?: number }
        Returns: number
      }
      send_new_member_daily_summary: { Args: never; Returns: Json }
      send_ops_daily_digest: { Args: never; Returns: Json }
      send_team_reply: {
        Args: { p_client_id?: string; p_content: string }
        Returns: {
          attachment_duration: number | null
          attachment_mime: string | null
          attachment_size: number | null
          attachment_url: string | null
          client_id: string | null
          content: string
          created_at: string
          edited_at: string | null
          flag_reason: string | null
          flagged_hidden: boolean
          id: string
          is_system: boolean
          job_id: string | null
          read: boolean
          read_at: string | null
          receiver_id: string | null
          reply_to_id: string | null
          sender_id: string
          team_thread_user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      series_give_up_strike: {
        Args: { p_dates: string[]; p_helper: string; p_parent: string }
        Returns: boolean
      }
      series_release_dates: {
        Args: {
          p_customer: string
          p_dates: string[]
          p_helper: string
          p_parent: string
          p_reason: string
          p_title: string
        }
        Returns: string[]
      }
      series_visit_dates: {
        Args: { p_days: number[]; p_start: string; p_weeks: number }
        Returns: string[]
      }
      session_email_unconfirmed: { Args: never; Returns: boolean }
      set_available_now: { Args: { p_hours?: number }; Returns: string }
      set_sms_consent: {
        Args: { p_opt_in: boolean; p_phone: string }
        Returns: Json
      }
      set_sms_job_match_texts: { Args: { p_on: boolean }; Returns: Json }
      set_thread_snooze: {
        Args: { _job_id: string; _other_user_id: string; _until: string }
        Returns: string
      }
      settle_dispute_by_chargeback: {
        Args: {
          _charge_cents: number
          _disputed_cents: number
          _job_id: string
          _stripe_dispute_id: string
        }
        Returns: Json
      }
      settle_dispute_by_external_refund: {
        Args: {
          _charge_cents: number
          _job_id: string
          _refunded_cents: number
          _stripe_charge_id: string
        }
        Returns: Json
      }
      settle_dispute_record: {
        Args: {
          _decided_by?: string
          _decision_text?: string
          _helper_cents?: number
          _job_id: string
          _outcome: string
          _refund_cents?: number
          _refund_id?: string
          _transfer_id?: string
        }
        Returns: string
      }
      settle_job_detail_change: {
        Args: { p_request_id: string }
        Returns: string
      }
      settle_one_off_jobs_for_banned_account: {
        Args: { p_user: string }
        Returns: Json
      }
      shipping_rate_buyable: {
        Args: { p_rate_cents: number; p_shipment_id: string }
        Returns: boolean
      }
      shop_active_strike_count: {
        Args: { p_user_id: string }
        Returns: number
      }
      shop_badges: { Args: { p_shop_id: string }; Returns: Json }
      shop_contact_leak_reason: { Args: { p_text: string }; Returns: string }
      shop_cottage_cap_reached: {
        Args: { p_owner_id: string }
        Returns: boolean
      }
      shop_cottage_sales_cents: {
        Args: { p_owner_id: string }
        Returns: number
      }
      shop_cottage_year: { Args: never; Returns: number }
      shop_extras_readable: { Args: { p_shop_id: string }; Returns: boolean }
      shop_give_strike: {
        Args: { p_order: string; p_reason: string; p_side: string; p_user: string }
        Returns: string
      }
      shop_hand_refund_failed: {
        Args: { p_stripe_refund_id: string }
        Returns: string
      }
      shop_hold_order_for_hand_refund: {
        Args: { p_order_id: string; p_why: string }
        Returns: undefined
      }
      shop_item_required_statements: {
        Args: { p_kind: string; p_subtype: string }
        Returns: string[]
      }
      shop_item_text_flag: {
        Args: { p_description: string; p_kind: string; p_title: string }
        Returns: string
      }
      shop_attach_checkout_session: {
        Args: { p_order_id: string; p_session_id: string }
        Returns: undefined
      }
      shop_captures_due: {
        Args: { p_limit: number }
        Returns: {
          attempts: number
          buyer_id: string
          checkout_session_id: string
          livemode: boolean
          order_id: string
          payment_intent_id: string
          seller_id: string
          total_cents: number
        }[]
      }
      shop_day_count: {
        Args: { p_day: string; p_seller: string; p_statuses: string[] }
        Returns: number
      }
      shop_hold_release_failed: {
        Args: { p_error: string; p_order_id: string }
        Returns: undefined
      }
      shop_hold_released: { Args: { p_order_id: string }; Returns: undefined }
      shop_holds_to_release: {
        Args: { p_limit: number }
        Returns: {
          buyer_id: string
          checkout_session_id: string
          livemode: boolean
          order_id: string
          payment_intent_id: string
          seller_id: string
        }[]
      }
      shop_line_unit_cents: {
        Args: { p_item_id: string; p_variant_id: string }
        Returns: number
      }
      shop_link_visible: { Args: { p_shop_id: string }; Returns: boolean }
      shop_local_today: { Args: never; Returns: string }
      shop_lock_open_charged_order: {
        Args: { p_allow_problem: boolean; p_order_id: string }
        Returns: unknown
      }
      shop_mark_order_held: {
        Args: {
          p_amount_total: number
          p_livemode: boolean
          p_payment_intent_id: string
          p_session_id: string
          p_tax_cents: number
        }
        Returns: Json
      }
      shop_order_capture_failed: {
        Args: { p_error: string; p_final: boolean; p_order_id: string }
        Returns: Json
      }
      shop_order_captured: {
        Args: { p_card_fee_cents: number; p_order_id: string }
        Returns: Json
      }
      shop_order_sweep: { Args: never; Returns: Json }
      shop_order_unaccounted_hand_refund: {
        Args: { p_order_id: string }
        Returns: boolean
      }
      shop_owe_shop: {
        Args: { p_order_id: string }
        Returns: number
      }
      shop_owner_in_good_standing: {
        Args: { p_owner_id: string }
        Returns: boolean
      }
      shop_owner_sell_block_reason: {
        Args: { p_owner_id: string }
        Returns: string
      }
      shop_owner_rating: {
        Args: { p_owner_id: string }
        Returns: {
          rating: number
          review_count: number
        }[]
      }
      shop_publicly_visible: { Args: { p_shop_id: string }; Returns: boolean }
      shop_record_hand_refund: {
        Args: { p_admin: string; p_amount_cents: number; p_how: string; p_livemode: boolean; p_note: string; p_payment_intent_id: string; p_stripe_refund_id: string }
        Returns: string
      }
      shop_refund_amounts: {
        Args: { p_order_id: string; p_reason: string }
        Returns: {
          card_fee_cents: number
          fee_policy: string
          kept_cents: number
          paid_cents: number
          refund_cents: number
          tax_cents: number
          tax_kept_cents: number
        }[]
      }
      shop_refund_executed: {
        Args: { p_error: string; p_refund_id: string; p_stripe_refund_id: string; p_succeeded: boolean }
        Returns: string
      }
      shop_refund_fee_policy: {
        Args: { p_reason: string }
        Returns: string
      }
      shop_refund_reversed: {
        Args: { p_refund_id: string; p_stripe_refund_id: string }
        Returns: boolean
      }
      shop_refund_sweep: { Args: never; Returns: Json }
      shop_refund_tax_kept: {
        Args: { p_kept: number; p_paid: number; p_tax: number }
        Returns: number
      }
      shop_refund_to_send: {
        Args: { p_refund_id: string }
        Returns: {
          attempts: number
          buyer_id: string
          checkout_session_id: string
          livemode: boolean
          order_id: string
          payment_intent_id: string
          refund_cents: number
          refund_id: string
          reversals: number
          seller_id: string
        }[]
      }
      shop_refunds_due: {
        Args: { p_limit: number }
        Returns: {
          attempts: number
          buyer_id: string
          checkout_session_id: string
          livemode: boolean
          order_id: string
          payment_intent_id: string
          refund_cents: number
          refund_id: string
          reversals: number
          seller_id: string
        }[]
      }
      shop_return_stock: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      shop_state_ok: { Args: { p_shop_id: string }; Returns: boolean }
      shop_text_clean: { Args: { p_text: string }; Returns: string }
      shop_visible_to: {
        Args: { p_shop_id: string; p_viewer: string }
        Returns: boolean
      }
      shop_write_refund: {
        Args: { p_note: string; p_order_id: string; p_reason: string }
        Returns: unknown
      }
      shops_accept_order: { Args: { p_order_id: string }; Returns: Json }
      shops_admin_record_hand_refund: {
        Args: { p_admin: string; p_amount_cents: number; p_note: string; p_order_id: string; p_stripe_refund_id: string }
        Returns: Json
      }
      shops_admin_refund_order: {
        Args: { p_note: string; p_order_id: string; p_reason: string }
        Returns: Json
      }
      shops_admin_settle_held_refund: {
        Args: { p_admin: string; p_amount_cents: number; p_note: string; p_refund_id: string; p_stripe_refund_id: string }
        Returns: Json
      }
      shops_buyer_cancel_order: {
        Args: { p_expect: string; p_order_id: string }
        Returns: Json
      }
      shops_cancel_order_request: {
        Args: { p_order_id: string }
        Returns: Json
      }
      shops_decline_order: {
        Args: { p_order_id: string; p_reason: string }
        Returns: Json
      }
      shops_order_pickup_address: {
        Args: { p_order_id: string }
        Returns: {
          city: string
          line1: string
          line2: string
          postal_code: string
          state: string
        }[]
      }
      shops_order_terms: { Args: { p_shop_id: string }; Returns: Json }
      shops_report_no_show: {
        Args: { p_order_id: string }
        Returns: Json
      }
      shops_request_order: {
        Args: {
          p_lines: Json
          p_note: string
          p_ready_date: string
          p_shop_id: string
        }
        Returns: Json
      }
      shops_set_cancel_policy: { Args: { p_policy: string }; Returns: string }
      shop_complete_handover: {
        Args: { p_how: string; p_order_id: string }
        Returns: Json
      }
      shop_handover_photo_access: {
        Args: { p_name: string; p_write: boolean }
        Returns: boolean
      }
      shop_handover_sweep: { Args: never; Returns: Json }
      shop_order_free_cancel_until: {
        Args: { p_order_id: string }
        Returns: string
      }
      shop_payout_executed: {
        Args: {
          p_error: string
          p_payout_id: string
          p_succeeded: boolean
          p_transfer_id: string
        }
        Returns: string
      }
      shop_payouts_due: {
        Args: { p_limit: number }
        Returns: {
          amount_cents: number
          attempts: number
          buyer_id: string
          checkout_session_id: string
          livemode: boolean
          order_id: string
          payment_intent_id: string
          payout_id: string
          seller_id: string
          stripe_account_id: string
        }[]
      }
      shops_confirm_pickup: { Args: { p_order_id: string }; Returns: Json }
      shops_mark_ready: {
        Args: { p_order_id: string; p_photo_path: string }
        Returns: Json
      }
      shops_report_not_received: {
        Args: { p_note: string; p_order_id: string }
        Returns: Json
      }
      shops_set_handover_mode: { Args: { p_mode: string }; Returns: string }
      shops_order_cancel_quote: { Args: { p_order_id: string }; Returns: Json }
      shops_admin_queue: { Args: never; Returns: Json }
      shops_admin_pay_shop: { Args: { p_note: string; p_order_id: string }; Returns: Json }
      shops_admin_remove_strike: { Args: { p_note: string; p_strike_id: string }; Returns: Json }
      shops_admin_give_strike: {
        Args: { p_note: string; p_order_id: string; p_side: string }
        Returns: Json
      }
      shops_set_ready_tap_cancel: { Args: { p_choice: string }; Returns: string }
      shops_add_item_photo: {
        Args: { p_item_id: string; p_storage_path: string }
        Returns: string
      }
      shops_admin_pending_items: {
        Args: never
        Returns: {
          ai_checked_at: string
          ai_flag_reason: string
          approved_items: number
          description: string
          item_id: string
          kind: string
          owner_id: string
          owner_last_rejected_at: string
          owner_last_rejection_note: string
          photo_paths: string[]
          price_cents: number
          shop_id: string
          shop_name: string
          submitted_at: string
          subtype: string
          text_flag_reason: string
          title: string
        }[]
      }
      shops_admin_check_registration: {
        Args: { p_shop_id: string; p_verified: boolean }
        Returns: boolean
      }
      shops_admin_set_hidden: {
        Args: { p_hidden: boolean; p_reason: string; p_shop_id: string }
        Returns: boolean
      }
      shops_admin_review_item: {
        Args: {
          p_approve: boolean
          p_item_id: string
          p_note: string
          p_submitted_at: string
        }
        Returns: string
      }
      shops_assert_owner_eligible: { Args: never; Returns: string }
      shops_attest_item: {
        Args: { p_item_id: string; p_statements: string[] }
        Returns: string
      }
      shops_attach_photo: {
        Args: { p_kind: string; p_storage_path: string }
        Returns: Json
      }
      shops_browse: {
        Args: {
          p_category?: string
          p_group?: string
          p_lat: number
          p_limit?: number
          p_lng: number
          p_offset?: number
        }
        Returns: {
          area_label: string
          badges: Json
          category: string
          id: string
          logo_path: string
          miles: number
          name: string
          paused: boolean
          pin_lat: number
          pin_lng: number
          rating: number
          review_count: number
        }[]
      }
      shops_check_item_fields: {
        Args: {
          p_description: string
          p_kind: string
          p_lead_time_days: number
          p_price_cents: number
          p_stock_count: number
          p_subtype: string
          p_title: string
        }
        Returns: undefined
      }
      shops_close_my_shop: { Args: never; Returns: string[] }
      shops_confirm_cottage_year: { Args: never; Returns: number }
      shops_create_item: {
        Args: {
          p_description: string
          p_kind: string
          p_lead_time_days: number
          p_price_cents: number
          p_stock_count: number
          p_subtype: string
          p_title: string
        }
        Returns: string
      }
      shops_get_shop: { Args: { p_shop_id: string }; Returns: Json }
      shops_lock_own_item: {
        Args: { p_item_id: string; p_uid: string }
        Returns: {
          admin_approved_at: string | null
          created_at: string
          description: string
          id: string
          is_seed: boolean
          kind: string
          lead_time_days: number
          live_at: string | null
          owner_id: string
          price_cents: number
          shop_id: string
          status: string
          stock_count: number | null
          submitted_at: string | null
          subtype: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "shop_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      shops_my_cottage_status: { Args: never; Returns: Json }
      shops_my_item_review: {
        Args: { p_item_id: string }
        Returns: {
          ai_checked: boolean
          ai_flagged: boolean
          attested: boolean
          review_note: string
          text_flagged: boolean
        }[]
      }
      shops_my_pickup_address: {
        Args: never
        Returns: {
          city: string
          line1: string
          line2: string
          postal_code: string
          state: string
          updated_at: string
        }[]
      }
      shops_my_shop_id: { Args: never; Returns: string }
      shops_publish_item: { Args: { p_item_id: string }; Returns: string }
      shops_public_photo_path: {
        Args: { p_kind: string; p_photo_id: string }
        Returns: string
      }
      shops_public_shop: { Args: { p_shop_id: string }; Returns: Json }
      shops_record_item_ai_check: {
        Args: {
          p_flag_reason: string
          p_judged_description: string
          p_judged_kind: string
          p_judged_photo_ids: string[]
          p_judged_subtype: string
          p_judged_title: string
          p_item_id: string
          p_owner_id: string
        }
        Returns: string
      }
      shops_remove_item_photo: { Args: { p_photo_id: string }; Returns: string }
      shops_remove_photo: { Args: { p_photo_id: string }; Returns: string }
      shops_save_my_pickup_address: {
        Args: {
          p_city: string
          p_line1: string
          p_line2: string
          p_postal_code: string
        }
        Returns: undefined
      }
      shops_save_my_shop: {
        Args: {
          p_about: string
          p_area_label: string
          p_category: string
          p_name: string
          p_offers_quotes: boolean
          p_offers_selling: boolean
          p_parishes_served: string[]
          p_pin_lat: number
          p_pin_lng: number
          p_sos_number: string
          p_storefront: boolean
        }
        Returns: string
      }
      shops_set_daily_order_cap: { Args: { p_cap: number }; Returns: number }
      shops_set_follow: {
        Args: { p_follow: boolean; p_shop_id: string }
        Returns: boolean
      }
      shops_set_hours: { Args: { p_hours: Json }; Returns: number }
      shops_set_my_faqs: { Args: { p_faqs: Json }; Returns: number }
      shops_set_paused: { Args: { p_paused: boolean }; Returns: boolean }
      shops_set_item_stock: {
        Args: { p_item_id: string; p_lead_time_days: number; p_stock_count: number }
        Returns: number
      }
      shops_shop_cancel_order: {
        Args: { p_order_id: string; p_reason: string }
        Returns: Json
      }
      shops_shop_faqs: { Args: { p_shop_id: string }; Returns: Json }
      shops_shop_policies: { Args: { p_shop_id: string }; Returns: Json }
      shops_shop_items: { Args: { p_shop_id: string }; Returns: Json }
      shops_update_item: {
        Args: {
          p_description: string
          p_item_id: string
          p_kind: string
          p_lead_time_days: number
          p_price_cents: number
          p_stock_count: number
          p_subtype: string
          p_title: string
        }
        Returns: string
      }
      shops_withdraw_item: { Args: { p_item_id: string }; Returns: string[] }
      sms_category_of: { Args: { p_kind: string }; Returns: string }
      sms_claim_confirmation: {
        Args: { p_provider_ready: boolean; p_user_id: string }
        Returns: Json
      }
      sms_claim_due: {
        Args: { p_limit: number; p_now?: string; p_provider_ready: boolean }
        Returns: Json[]
      }
      sms_dispatch_due: { Args: never; Returns: Json }
      sms_inbound_keyword: {
        Args: { p_action: string; p_code?: string; p_phone: string }
        Returns: number
      }
      sms_kind_for: {
        Args: { p_job_id: string; p_title: string; p_type: string }
        Returns: string
      }
      sms_normalize_phone: { Args: { p_phone: string }; Returns: string }
      sms_post_to_edge: { Args: { p_body: Json }; Returns: undefined }
      sms_quiet_release: {
        Args: { p_at: string; p_end: string; p_start: string }
        Returns: string
      }
      sms_record_result: {
        Args: {
          p_error_code: string
          p_provider_sid: string
          p_sms_id: string
          p_status: string
        }
        Returns: boolean
      }
      split_special_requirements: {
        Args: { p_text: string }
        Returns: { access: string; materials: string }[]
      }
      stamp_dispute_settlement_claim: {
        Args: { _job_id: string; _token: string }
        Returns: boolean
      }
      start_underfilled_crews: { Args: never; Returns: number }
      submit_job_quote: {
        Args: {
          p_available_note: string
          p_note: string
          p_photo_paths?: string[]
          p_price_cents: number
          p_request_id: string
        }
        Returns: string
      }
      subscription_purchase_eligibility: {
        Args: { p_platform: string }
        Returns: Json
      }
      suggest_category: {
        Args: { p_area: string; p_suggestion: string }
        Returns: string
      }
      sweep_backout_notice_reminders: {
        Args: never
        Returns: number
      }
      sweep_confirm_reminders_and_repost: {
        Args: never
        Returns: Json
      }
      sweep_cron_blackouts: { Args: never; Returns: Json }
      sweep_cron_http_failures: { Args: never; Returns: Json }
      sweep_cron_startup_failures: { Args: never; Returns: Json }
      sweep_daily_job_digest: { Args: never; Returns: number }
      sweep_dayof_confirm_reminders: { Args: never; Returns: number }
      sweep_dead_crons: { Args: never; Returns: Json }
      sweep_disputes_closed_without_payment: { Args: never; Returns: Json }
      sweep_email_dlqs: { Args: never; Returns: Json }
      sweep_expired_auto_bans: { Args: never; Returns: number }
      sweep_helpr_start_reminders: {
        Args: { p_now?: string }
        Returns: number
      }
      sweep_job_match_queue: { Args: never; Returns: number }
      sweep_job_post_drafts: { Args: { p_now?: string }; Returns: number }
      sweep_job_start_reminders: { Args: never; Returns: number }
      sweep_no_show_alerts: { Args: never; Returns: number }
      sweep_old_email_send_log: { Args: never; Returns: number }
      sweep_old_error_logs: { Args: never; Returns: number }
      sweep_old_notifications: { Args: never; Returns: number }
      sweep_open_ban_settlement_reviews: { Args: never; Returns: Json }
      sweep_payout_schedule_freezes: { Args: never; Returns: Json }
      sweep_idv_review_waiting: { Args: never; Returns: Json }
      sweep_quote_alerts: { Args: never; Returns: Json }
      sweep_release_last_chance: { Args: never; Returns: Json }
      sweep_saved_search_alert_queue: { Args: never; Returns: number }
      sweep_signup_leads: { Args: never; Returns: Json }
      sweep_silent_cron_failures: { Args: never; Returns: Json }
      sweep_unanswered_applications: {
        Args: { p_now?: string }
        Returns: number
      }
      sweep_unfilled_series_visit_reminders: { Args: never; Returns: number }
      sync_jobs_select_grants: { Args: never; Returns: Json }
      sync_profiles_update_grants: { Args: never; Returns: Json }
      switch_quote_request_to_set_price: {
        Args: { p_budget: number; p_request_id: string }
        Returns: string
      }
      take_helpr_fault_fee: {
        Args: { p_helper_id: string; p_max_cents: number; p_payout_ref: string }
        Returns: number
      }
      toggle_thread_mute: {
        Args: { _job_id: string; _other_user_id: string }
        Returns: boolean
      }
      unregister_push_subscription: {
        Args: { p_endpoint: string }
        Returns: number
      }
      user_error_screen_is_real: {
        Args: { p_tags: Json; p_user_id: string }
        Returns: boolean
      }
      user_error_screen_title: {
        Args: { p_message: string; p_screen: string }
        Returns: string
      }
      user_has_pending_application: {
        Args: { _job_id: string; _user_id: string }
        Returns: boolean
      }
      user_may_see_job_address: {
        Args: { _job_id: string; _user_id: string }
        Returns: boolean
      }
      user_report_is_open: { Args: { p_status: string }; Returns: boolean }
      user_report_is_real: { Args: { p_reporter_id: string }; Returns: boolean }
      user_report_severity: {
        Args: { p_reason: string; p_reported_type: string }
        Returns: string
      }
      user_report_title: {
        Args: { p_reason: string; p_reported_type: string }
        Returns: string
      }
      wipe_pre_verification_account: {
        Args: { p_user_id: string }
        Returns: string
      }
      withdraw_job_schedule_change: {
        Args: { p_request_id: string }
        Returns: Json
      }
      withdraw_job_quote: {
        Args: { p_quote_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "customer" | "helper"
      application_status: "pending" | "accepted" | "rejected"
      auto_tip_mode: "off" | "percent" | "fixed"
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
        | "electrical"
        | "plumbing"
        | "hvac"
        | "roofing"
        | "welding"
        | "carpentry"
        | "auto_repair"
        | "appliance_repair"
        | "flooring"
        | "concrete_masonry"
        | "fencing"
        | "pressure_washing"
        | "declutter_help"
      job_status:
        | "open"
        | "accepted"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "revision_requested"
        | "disputed"
        | "pending_approval"
      marketing_channel: "instagram" | "facebook"
      marketing_status:
        | "draft"
        | "scheduled"
        | "publishing"
        | "published"
        | "failed"
        | "cancelled"
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
      app_role: ["admin", "customer", "helper"],
      application_status: ["pending", "accepted", "rejected"],
      auto_tip_mode: ["off", "percent", "fixed"],
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
        "electrical",
        "plumbing",
        "hvac",
        "roofing",
        "welding",
        "carpentry",
        "auto_repair",
        "appliance_repair",
        "flooring",
        "concrete_masonry",
        "fencing",
        "pressure_washing",
        "declutter_help",
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
      marketing_channel: ["instagram", "facebook"],
      marketing_status: [
        "draft",
        "scheduled",
        "publishing",
        "published",
        "failed",
        "cancelled",
      ],
    },
  },
} as const
