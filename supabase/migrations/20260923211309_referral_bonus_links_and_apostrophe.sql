-- Q310: check_referral_bonus, restated from 20260923205635 (its effective definition) verbatim except:
-- (1) all 4 notification links open the referral tab ('/profile?tab=referral'), as 20260831232514 had
--     made them before 20260902014651 restated older text; (2) the poster-referral message's
--     over-escaped ''''s (rendered "referral''s") is now ''s ("referral's").
CREATE OR REPLACE FUNCTION public.check_referral_bonus()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public'
    AS $body$
    DECLARE
      v_referral RECORD;
    BEGIN
      IF NOT (TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status != 'completed') THEN
        RETURN NEW;
      END IF;

      IF NEW.helper_id IS NOT NULL THEN
        SELECT r.id, r.referrer_id, r.referred_id, r.referral_code_id
        INTO v_referral
        FROM public.referrals r
        WHERE r.referred_id = NEW.helper_id
          AND NOT EXISTS (
            SELECT 1 FROM public.referral_credits rc
            WHERE rc.user_id = NEW.helper_id
              AND rc.reason = 'first_job_bonus'
              AND rc.referral_code_id = r.referral_code_id
          );

        IF FOUND THEN
          INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
          VALUES (NEW.helper_id, 5, 'first_job_bonus', v_referral.referral_code_id, v_referral.referrer_id)
          ON CONFLICT DO NOTHING;

          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (NEW.helper_id, 'Referral bonus earned!',
                  'You completed your first job as a helper and earned a $5 referral credit!', 'payment', '/profile?tab=referral', NEW.id);

          -- The referrer's half, skipped when the referrer has deleted their
          -- account. NOT NULL on referral_credits.user_id and notifications
          -- .user_id would otherwise 23502 and roll back the referee's job.
          IF v_referral.referrer_id IS NOT NULL THEN
            INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
            VALUES (v_referral.referrer_id, 5, 'referrer_bonus', v_referral.referral_code_id, NEW.helper_id)
            ON CONFLICT DO NOTHING;

            INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
            VALUES (v_referral.referrer_id, 'Referral bonus!',
                    'Your referral completed their first job as a helper. You earned a $5 credit!', 'payment', '/profile?tab=referral', NEW.id);
          END IF;
        END IF;
      END IF;

      SELECT r.id, r.referrer_id, r.referred_id, r.referral_code_id
      INTO v_referral
      FROM public.referrals r
      WHERE r.referred_id = NEW.customer_id
        AND NOT EXISTS (
          SELECT 1 FROM public.referral_credits rc
          WHERE rc.user_id = NEW.customer_id
            AND rc.reason = 'first_job_bonus'
            AND rc.referral_code_id = r.referral_code_id
        );

      IF FOUND THEN
        INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
        VALUES (NEW.customer_id, 5, 'first_job_bonus', v_referral.referral_code_id, v_referral.referrer_id)
        ON CONFLICT DO NOTHING;

        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        VALUES (NEW.customer_id, 'Referral bonus earned!',
                'Your first posted job was completed — you earned a $5 referral credit!', 'payment', '/profile?tab=referral', NEW.id);

        IF v_referral.referrer_id IS NOT NULL THEN
          INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
          VALUES (v_referral.referrer_id, 5, 'referrer_bonus', v_referral.referral_code_id, NEW.customer_id)
          ON CONFLICT DO NOTHING;

          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (v_referral.referrer_id, 'Referral bonus!',
                  'Your referral''s first posted job was completed. You earned a $5 credit!', 'payment', '/profile?tab=referral', NEW.id);
        END IF;
      END IF;

      RETURN NEW;
    END;
    $body$;
