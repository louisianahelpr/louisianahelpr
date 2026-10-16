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
      cancellation_fee_transfers: {
        Row: {
          commission_percent: number
          created_at: string
          failure_reason: string | null
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
          buyer_id: string
          buyer_missed_at: string | null
          buyer_rebooked: boolean
          buyer_reschedules: number
          created_at: string
          is_seed: boolean
          order_id: string
          porch_mode: string | null
          porch_until: string | null
          seller_id: string
          seller_reschedules: number
          slot_end: string | null
          slot_start: string | null
          updated_at: string
        }
        Insert: {
          buyer_id: string
          buyer_missed_at?: string | null
          buyer_rebooked?: boolean
          buyer_reschedules?: number
          created_at?: string
          is_seed?: boolean
          order_id: string
          porch_mode?: string | null
          porch_until?: string | null
          seller_id: string
          seller_reschedules?: number
          slot_end?: string | null
          slot_start?: string | null
          updated_at?: string
        }
        Update: {
          buyer_id?: string
          buyer_missed_at?: string | null
          buyer_rebooked?: boolean
          buyer_reschedules?: number
          created_at?: string
          is_seed?: boolean
          order_id?: string
          porch_mode?: string | null
          porch_until?: string | null
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
          buyer_id: string
          checkout_by: string
          closed_at: string | null
          created_at: string
          id: string
          is_seed: boolean
          item_id: string
          offer_id: string | null
          order_id: string | null
          price_cents: number
          reminded_24h_at: string | null
          reminded_2h_at: string | null
          seller_id: string
          source: string
          status: string
        }
        Insert: {
          buyer_id: string
          checkout_by: string
          closed_at?: string | null
          created_at?: string
          id?: string
          is_seed?: boolean
          item_id: string
          offer_id?: string | null
          order_id?: string | null
          price_cents: number
          reminded_24h_at?: string | null
          reminded_2h_at?: string | null
          seller_id: string
          source: string
          status?: string
        }
        Update: {
          buyer_id?: string
          checkout_by?: string
          closed_at?: string | null
          created_at?: string
          id?: string
          is_seed?: boolean
          item_id?: string
          offer_id?: string | null
          order_id?: string | null
          price_cents?: number
          reminded_24h_at?: string | null
          reminded_2h_at?: string | null
          seller_id?: string
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
      declutter_delivery_refunds: {
        Row: {
          attempts: number
          created_at: string
          executed_at: string | null
          id: string
          is_seed: boolean
          last_error: string | null
          next_attempt_at: string
          order_id: string
          reason: string
          refund_cents: number
          status: string
          stripe_payment_intent_id: string
          stripe_refund_ref: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          executed_at?: string | null
          id?: string
          is_seed?: boolean
          last_error?: string | null
          next_attempt_at?: string
          order_id: string
          reason: string
          refund_cents: number
          status?: string
          stripe_payment_intent_id: string
          stripe_refund_ref?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          executed_at?: string | null
          id?: string
          is_seed?: boolean
          last_error?: string | null
          next_attempt_at?: string
          order_id?: string
          reason?: string
          refund_cents?: number
          status?: string
          stripe_payment_intent_id?: string
          stripe_refund_ref?: string | null
        }
        Relationships: [
        ]
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
      declutter_handovers: {
        Row: {
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
          wrong_attempts: number
        }
        Insert: {
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
          wrong_attempts?: number
        }
        Update: {
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
      declutter_item_private: {
        Row: {
          ai_checked_at: string | null
          ai_flag_reason: string | null
          drop_stop_cents: number | null
          floor_price_cents: number
          item_id: string
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          review_note: string | null
          seller_id: string
          updated_at: string
        }
        Insert: {
          ai_checked_at?: string | null
          ai_flag_reason?: string | null
          drop_stop_cents?: number | null
          floor_price_cents: number
          item_id: string
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
          review_note?: string | null
          seller_id: string
          updated_at?: string
        }
        Update: {
          ai_checked_at?: string | null
          ai_flag_reason?: string | null
          drop_stop_cents?: number | null
          floor_price_cents?: number
          item_id?: string
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
          ends_at: string | null
          id: string
          is_seed: boolean
          last_price_drop_on: string | null
          live_at: string | null
          porch_ok: boolean
          price_cents: number
          price_dropped_at: string | null
          relist_count: number
          sale_mode: string
          seller_id: string
          status: string
          submitted_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
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
          ends_at?: string | null
          id?: string
          is_seed?: boolean
          last_price_drop_on?: string | null
          live_at?: string | null
          porch_ok?: boolean
          price_cents: number
          price_dropped_at?: string | null
          relist_count?: number
          sale_mode?: string
          seller_id: string
          status?: string
          submitted_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
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
          ends_at?: string | null
          id?: string
          is_seed?: boolean
          last_price_drop_on?: string | null
          live_at?: string | null
          porch_ok?: boolean
          price_cents?: number
          price_dropped_at?: string | null
          relist_count?: number
          sale_mode?: string
          seller_id?: string
          status?: string
          submitted_at?: string | null
          title?: string
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
      declutter_orders: {
        Row: {
          delivery_cents: number
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
        Insert: {
          delivery_cents?: number
          buyer_id: string
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
          premium_cents: number
          seller_id: string
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          tax_cents?: number
          total_cents: number
        }
        Update: {
          delivery_cents?: number
          buyer_id?: string
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
          premium_cents?: number
          seller_id?: string
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
          attempts: number
          created_at: string
          debt_cents: number
          executed_at: string | null
          id: string
          is_seed: boolean
          items_cents: number
          last_error: string | null
          next_attempt_at: string
          order_id: string
          seller_id: string | null
          status: string
          stripe_transfer_id: string | null
        }
        Insert: {
          amount_cents: number
          attempts?: number
          created_at?: string
          debt_cents: number
          executed_at?: string | null
          id?: string
          is_seed?: boolean
          items_cents: number
          last_error?: string | null
          next_attempt_at?: string
          order_id: string
          seller_id?: string | null
          status: string
          stripe_transfer_id?: string | null
        }
        Update: {
          amount_cents?: number
          attempts?: number
          created_at?: string
          debt_cents?: number
          executed_at?: string | null
          id?: string
          is_seed?: boolean
          items_cents?: number
          last_error?: string | null
          next_attempt_at?: string
          order_id?: string
          seller_id?: string | null
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
      declutter_problems: {
        Row: {
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
        }
        Insert: {
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
        }
        Update: {
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
      declutter_refunds: {
        Row: {
          attempts: number
          card_fee_cents: number
          created_at: string
          executed_at: string | null
          fee_policy: string
          gave_up_notified_at: string | null
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
      declutter_seller_fee_debts: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          is_seed: boolean
          refund_id: string
          remaining_cents: number
          seller_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          is_seed?: boolean
          refund_id: string
          remaining_cents: number
          seller_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          is_seed?: boolean
          refund_id?: string
          remaining_cents?: number
          seller_id?: string
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
          created_at: string
          expires_at: string
          id: string
          is_seed: boolean
          max_price_cents: number
          radius_miles: number
          status: string
          user_id: string
          what: string
        }
        Insert: {
          area_lat: number
          area_lng: number
          category: string
          closed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          is_seed?: boolean
          max_price_cents: number
          radius_miles: number
          status?: string
          user_id: string
          what: string
        }
        Update: {
          area_lat?: number
          area_lng?: number
          category?: string
          closed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          is_seed?: boolean
          max_price_cents?: number
          radius_miles?: number
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
          created_at: string
          decided_at: string | null
          decided_by: string | null
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
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
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
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
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
          executed_at: string | null
          fee_cents: number
          helpr_id: string | null
          id: string
          is_seed: boolean
          last_error: string | null
          next_attempt_at: string
          pay_cents: number
          status: string
          stripe_transfer_id: string | null
          task_id: string
        }
        Insert: {
          amount_cents: number
          attempts?: number
          created_at?: string
          executed_at?: string | null
          fee_cents: number
          helpr_id?: string | null
          id?: string
          is_seed?: boolean
          last_error?: string | null
          next_attempt_at?: string
          pay_cents: number
          status: string
          stripe_transfer_id?: string | null
          task_id: string
        }
        Update: {
          amount_cents?: number
          attempts?: number
          created_at?: string
          executed_at?: string | null
          fee_cents?: number
          helpr_id?: string | null
          id?: string
          is_seed?: boolean
          last_error?: string | null
          next_attempt_at?: string
          pay_cents?: number
          status?: string
          stripe_transfer_id?: string | null
          task_id?: string
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
          helpr_id: string | null
          id: string
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
          releases: number
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
          helpr_id?: string | null
          id?: string
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
          releases?: number
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
          helpr_id?: string | null
          id?: string
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
          releases?: number
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
          has_truck: boolean
          is_seed: boolean
          photo_path: string | null
          second_person: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          has_truck?: boolean
          is_seed?: boolean
          photo_path?: string | null
          second_person?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
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
          user_id: string
          via: string
        }
        Insert: {
          notified_at?: string
          user_id: string
          via: string
        }
        Update: {
          notified_at?: string
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
          email_enabled: boolean
          email_financial_alerts: boolean
          email_job_applications: boolean
          email_job_matches: boolean
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
          job_matches: boolean
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
          saved_helper_availability: boolean
          system_alerts: boolean
          transit_updates: boolean
          updated_at: string
          user_id: string
          work_status: boolean
        }
        Insert: {
          created_at?: string
          email_enabled?: boolean
          email_financial_alerts?: boolean
          email_job_applications?: boolean
          email_job_matches?: boolean
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
          job_matches?: boolean
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
          saved_helper_availability?: boolean
          system_alerts?: boolean
          transit_updates?: boolean
          updated_at?: string
          user_id: string
          work_status?: boolean
        }
        Update: {
          created_at?: string
          email_enabled?: boolean
          email_financial_alerts?: boolean
          email_job_applications?: boolean
          email_job_matches?: boolean
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
          job_matches?: boolean
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
          saved_helper_availability?: boolean
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
          saved_helper_seen: Json
          senior_mode: boolean
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
          saved_helper_seen?: Json
          senior_mode?: boolean
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
          saved_helper_seen?: Json
          senior_mode?: boolean
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
      reports: {
        Row: {
          assigned_to: string | null
          created_at: string
          description: string | null
          id: string
          reason: string
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
          query: string | null
          radius_miles: number | null
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
          query?: string | null
          radius_miles?: number | null
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
          query?: string | null
          radius_miles?: number | null
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
      application_cap: { Args: { p_kind: string }; Returns: number }
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
        }[]
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
      client_compat_floor: { Args: never; Returns: number }
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
      declutter_address_access: {
        Args: { p_item_id: string; p_user_id: string }
        Returns: string
      }
      declutter_admin_decide_delivery_damage: { Args: { p_note: string; p_problem_id: string }; Returns: Json }
      declutter_admin_decide_problem: {
        Args: {
          p_decision: string
          p_fault: string
          p_note: string
          p_problem_id: string
          p_strike: boolean
        }
        Returns: Json
      }
      declutter_admin_pending_items: {
        Args: never
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
      declutter_admin_review_item: {
        Args: { p_approve: boolean; p_item_id: string; p_note: string }
        Returns: string
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
      declutter_assert_member: { Args: { p_selling: boolean }; Returns: string }
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
      declutter_buy_now: {
        Args: { p_expected_price_cents: number; p_item_id: string }
        Returns: string
      }
      declutter_buyer_fee_cents: { Args: { p_items_cents: number }; Returns: number }
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
      declutter_create_wanted: {
        Args: {
          p_category: string
          p_lat: number
          p_lng: number
          p_max_price_cents: number
          p_radius_miles: number
          p_what: string
        }
        Returns: string
      }
      declutter_deadline_sweep: { Args: never; Returns: Json }
      declutter_delivery_compute: { Args: { p_buyer: string; p_lines: string[]; p_seller: string }; Returns: unknown }
      declutter_delivery_on_task_event: { Args: { p_by: string; p_event: string; p_order_id: string; p_task: string }; Returns: Json }
      declutter_delivery_price_cents: { Args: { p_miles: number; p_sizes: string[] }; Returns: number }
      declutter_delivery_quote: { Args: { p_seller_id: string }; Returns: Json }
      declutter_delivery_refund: { Args: { p_order_id: string; p_reason: string }; Returns: string }
      declutter_delivery_refund_executed: { Args: { p_error: string; p_id: string; p_stripe_refund_id: string; p_succeeded: boolean }; Returns: string }
      declutter_delivery_refund_reversed: { Args: { p_id: string; p_stripe_refund_id: string; p_why: string }; Returns: string }
      declutter_delivery_refunds_due: { Args: { p_limit: number }; Returns: unknown }
      declutter_delivery_reserved_cents: { Args: { p_order_id: string }; Returns: number }
      declutter_delivery_slot_ok: { Args: { p_order_id: string; p_start: string }; Returns: boolean }
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
      declutter_hand_refund_failed: {
        Args: { p_stripe_refund_id: string; p_why: string }
        Returns: string
      }
      declutter_handover_photo_access: {
        Args: { p_name: string; p_write: boolean }
        Returns: boolean
      }
      declutter_handover_sweep: { Args: never; Returns: Json }
      declutter_has_agreed_sales: { Args: never; Returns: boolean }
      declutter_in_agreed_sale: { Args: { p_item_id: string; p_user_id: string }; Returns: boolean }
      declutter_item_address: {
        Args: { p_item_id: string }
        Returns: {
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
        }[]
      }
      declutter_leave_review: {
        Args: { p_comment: string; p_order_id: string; p_stars: number }
        Returns: string
      }
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
      declutter_miles: {
        Args: { p_lat1: number; p_lat2: number; p_lng1: number; p_lng2: number }
        Returns: number
      }
      declutter_money_words: { Args: { p_cents: number }; Returns: string }
      declutter_my_cart: {
        Args: never
        Returns: {
          checkout_by: string
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
          premium_cents: number | null
          price_cents: number
          seller_id: string
          status: string
          total_cents: number | null
        }[]
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
          item_id: string
          item_title: string
          my_side: string
          offer_id: string
          respond_by: string
          status: string
          updated_at: string
        }[]
      }
      declutter_my_wanted: {
        Args: never
        Returns: {
          category: string
          created_at: string
          expires_at: string
          id: string
          matches: Json
          max_price_cents: number
          radius_miles: number
          status: string
          what: string
        }[]
      }
      declutter_new_handover_code: { Args: never; Returns: string }
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
      declutter_publish_item: { Args: { p_item_id: string }; Returns: string }
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
      declutter_report_no_show: { Args: { p_order_id: string }; Returns: Json }
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
      declutter_road_miles: { Args: { p_lat1: number; p_lat2: number; p_lng1: number; p_lng2: number }; Returns: number }
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
      declutter_seller_cancel_sale: { Args: { p_item_id: string }; Returns: number }
      declutter_seller_hidden: { Args: { p_seller: string }; Returns: boolean }
      declutter_seller_item_private: {
        Args: { p_item_id: string }
        Returns: {
          floor_price_cents: number
          pickup_address: string
          pickup_lat: number
          pickup_lng: number
        }[]
      }
      declutter_seller_out: { Args: { p_seller: string }; Returns: boolean }
      declutter_set_delivery_dropoff: { Args: { p_address: string; p_area_label: string; p_buyer: string; p_lat: number; p_lng: number; p_seller: string }; Returns: undefined }
      declutter_set_pickup_windows: { Args: { p_windows: Json }; Returns: number }
      declutter_set_porch_ok: {
        Args: { p_item_id: string; p_porch_ok: boolean }
        Returns: boolean
      }
      declutter_set_porch_time: {
        Args: { p_mode: string; p_order_id: string; p_until: string }
        Returns: undefined
      }
      declutter_set_watch: {
        Args: { p_item_id: string; p_watch: boolean }
        Returns: string
      }
      declutter_slot_in_windows: {
        Args: { p_seller: string; p_start: string }
        Returns: boolean
      }
      declutter_start_checkout: {
        Args: { p_handover: string; p_seller_id: string }
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
        }[]
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
      declutter_withdraw_item: { Args: { p_item_id: string }; Returns: string[] }
      end_recurring_series_by_platform: {
        Args: {
          p_admin?: string
          p_job_id: string
          p_kind: string
          p_reason: string
        }
        Returns: Json
      }
      get_my_job_quotes: {
        Args: never
        Returns: {
          available_note: string
          created_at: string
          date_needed: string
          id: string
          job_id: string
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
      job_offer_cutoff: {
        Args: { p_date_needed: string; p_start_time: string }
        Returns: string
      }
      choose_new_social_account: {
        Args: { p_choice: string }
        Returns: boolean
      }
      claim_dispute_settlement: {
        Args: { _action: string; _admin_id?: string; _job_id: string }
        Returns: Json
      }
      claim_idv_attempt: {
        Args: {
          p_max_attempts?: number
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
      cleanup_observability_tables: { Args: never; Returns: Json }
      cleanup_stripe_webhook_events: { Args: never; Returns: number }
      clear_available_now: { Args: never; Returns: undefined }
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
        Returns: boolean
      }
      detect_stuck_payments: { Args: never; Returns: Json }
      detect_suspicious_user_patterns: { Args: never; Returns: number }
      direct_accept_block_reason: {
        Args: { p_helper: string; p_job_id: string }
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
      flag_possible_ban_evasion_by_identity: {
        Args: { p_nodoc_sha256: string; p_user_id: string }
        Returns: Json
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
      helpr_my_tasks: {
        Args: never
        Returns: {
          dropoff_area: string
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
      helpr_set_vehicle: { Args: { p_has_truck: boolean; p_photo_path: string; p_second_person: boolean }; Returns: Json }
      helpr_task_accept: { Args: { p_pickup_slot_start: string; p_task_id: string }; Returns: Json }
      helpr_task_assert_helpr: { Args: never; Returns: string }
      helpr_task_close: { Args: { p_note: string; p_status: string; p_task: string }; Returns: string }
      helpr_task_confirm: { Args: { p_actor: string; p_by: string; p_task: string }; Returns: Json }
      helpr_task_create: { Args: { p_customer: string; p_dropoff_address: string; p_dropoff_area: string; p_dropoff_lat: number; p_dropoff_lng: number; p_is_seed: boolean; p_kind: string; p_latest_pickup: string; p_open_until: string; p_pay_cents: number; p_pickup_address: string; p_pickup_area: string; p_pickup_contact: string; p_pickup_lat: number; p_pickup_lng: number; p_size: string; p_source: string; p_title: string; p_trip_miles: number }; Returns: string }
      helpr_task_customer_confirm: { Args: { p_task_id: string }; Returns: Json }
      helpr_task_delivered: { Args: { p_code: string; p_lat: number; p_lng: number; p_photo_path: string; p_task_id: string }; Returns: Json }
      helpr_task_distance_m: { Args: { p_lat1: number; p_lat2: number; p_lng1: number; p_lng2: number }; Returns: number }
      helpr_task_fee_cents: { Args: { p_pay_cents: number }; Returns: number }
      helpr_task_give_job_strike: { Args: { p_description: string; p_task: string; p_type: string; p_user: string }; Returns: Json }
      helpr_task_lock: { Args: { p_task: string }; Returns: unknown }
      helpr_task_log: { Args: { p_actor: string; p_detail: string; p_kind: string; p_task: string }; Returns: undefined }
      helpr_task_payout_executed: { Args: { p_error: string; p_payout_id: string; p_succeeded: boolean; p_transfer_id: string }; Returns: string }
      helpr_task_payouts_due: { Args: { p_limit: number }; Returns: unknown }
      helpr_task_photo_access: { Args: { p_name: string; p_write: boolean }; Returns: boolean }
      helpr_task_photo_ok: { Args: { p_path: string; p_task: string; p_uid: string }; Returns: boolean }
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
      helpr_task_vehicle_fits: { Args: { p_size: string; p_user: string }; Returns: boolean }
      helpr_task_view: { Args: { p_task_id: string }; Returns: Json }
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
      job_match_digest_rows: {
        Args: { p_queue_ids: string[] }
        Returns: {
          id: string
          send: boolean
        }[]
      }
      job_messaging_closes_at: { Args: { _job_id: string }; Returns: string }
      job_payment_is_funded: {
        Args: { p_payment_status: string }
        Returns: boolean
      }
      job_posted_by_seed: {
        Args: { p_customer_id: string }
        Returns: boolean
      }
      jobs_private_select_columns: { Args: never; Returns: string[] }
      kick_payout_schedule_sync: {
        Args: { p_helper_id: string }
        Returns: boolean
      }
      lift_ban_settlement_review: {
        Args: { p_admin_id: string; p_ban_status?: string; p_user_id: string }
        Returns: Json
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
      member_under_18: { Args: { p_user_id: string }; Returns: boolean }
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
      poster_cancel_job: {
        Args: { p_job_id: string; p_reason?: string }
        Returns: Json
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
      quote_notify: {
        Args: { p_message: string; p_title: string; p_user: string }
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
      record_error_log_throttle_drop: {
        Args: { p_kind: string }
        Returns: undefined
      }
      record_job_view: { Args: { p_job_id: string }; Returns: string }
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
      redeem_gift_card: {
        Args: {
          p_credit_id: string
          p_job_id: string
          p_retired_session?: string
          p_user_id: string
        }
        Returns: Json
      }
      refund_monthly_free_boost: {
        Args: { p_month: string; p_user_id: string }
        Returns: boolean
      }
      release_dispute_settlement_claim: {
        Args: { _job_id: string; _token?: string }
        Returns: boolean
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
      retain_ban_for_user: {
        Args: { p_user_id: string; p_via?: string }
        Returns: number
      }
      retain_ban_on_deletion: { Args: { p_user_id: string }; Returns: number }
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
      rpc_open_dispute: {
        Args: { _evidence_urls: string[]; _job_id: string; _reason: string }
        Returns: string
      }
      rpc_poster_confirm_member_arrival: {
        Args: { _helper_id: string; _job_id: string }
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
      run_missed_cron_catch_up: { Args: never; Returns: Json }
      run_seed_purge: { Args: never; Returns: Json }
      save_weekly_availability: { Args: { p_slots: Json }; Returns: number }
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
      sweep_job_match_queue: { Args: never; Returns: number }
      sweep_job_start_reminders: { Args: never; Returns: number }
      sweep_no_show_alerts: { Args: never; Returns: number }
      sweep_old_email_send_log: { Args: never; Returns: number }
      sweep_old_error_logs: { Args: never; Returns: number }
      sweep_old_notifications: { Args: never; Returns: number }
      sweep_open_ban_settlement_reviews: { Args: never; Returns: Json }
      sweep_payout_schedule_freezes: { Args: never; Returns: Json }
      sweep_release_last_chance: { Args: never; Returns: Json }
      sweep_saved_search_alert_queue: { Args: never; Returns: number }
      sweep_signup_leads: { Args: never; Returns: Json }
      sweep_silent_cron_failures: { Args: never; Returns: Json }
      sweep_unfilled_series_visit_reminders: { Args: never; Returns: number }
      sync_jobs_select_grants: { Args: never; Returns: Json }
      sync_profiles_update_grants: { Args: never; Returns: Json }
      switch_quote_request_to_set_price: {
        Args: { p_budget: number; p_request_id: string }
        Returns: string
      }
      toggle_thread_mute: {
        Args: { _job_id: string; _other_user_id: string }
        Returns: boolean
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
