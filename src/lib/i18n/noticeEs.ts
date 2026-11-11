/**
 * Server-written notices in Spanish, on the client (F260q, owner 11-11 "Spanish everything"; lead 11-11: render
 * notices in Spanish by type on the client). A notifications row holds only type / title / message, written in English
 * by Postgres and edge functions, with no template variables. So each known English shape below is matched whole and
 * re-written in Spanish, carrying over the parts that are the member's own words: names, quoted titles ("…"), places,
 * amounts. Dates and times are re-written too ("Fri, Nov 6" -> "vie 6 nov"). A row that matches no shape stays English
 * (nothing is guessed).
 *
 * Which shapes: read-only prod SQL (11-11), the 60 days' notices grouped by title and by message, most-seen first.
 * Tokens: {name} {name2} a person's name; {q} {q2} a quoted title (inside "…"); {amount} {amount2} "$12.34";
 * {date} "Fri, Nov 6" / "Mon Nov 9"; {time} "10:00 PM"; {place} a place or address; {n} a number; {cat} a job type.
 * Guard: src/test/noticesInSpanish.test.ts.
 */

type Shape = readonly [english: string, spanish: string];

// Titles first, then messages. Kept as one list: a template either matches the whole text or it doesn't.
export const NOTICE_SHAPES: readonly Shape[] = [
  // ── Titles ──
  ["New job posted", "Nuevo trabajo publicado"],
  ["New application", "Nueva postulación"],
  ["Your card is on hold", "Su tarjeta tiene una retención"],
  ["Your card was not charged", "No se le cobró a su tarjeta"],
  ["Job cancelled", "Trabajo cancelado"],
  ["Payment secured", "Pago asegurado"],
  ["Payment secured in escrow", "Pago asegurado y retenido"],
  ["{name} accepted your offer", "{name} aceptó su oferta"],
  ["{name} marked the job complete", "{name} marcó el trabajo como terminado"],
  ["Job complete", "Trabajo terminado"],
  ["Job completed!", "¡Trabajo terminado!"],
  ["How was your experience?", "¿Cómo fue su experiencia?"],
  ["Last reminder — how was your experience?", "Último recordatorio: ¿cómo fue su experiencia?"],
  ["{name} has arrived", "{name} llegó"],
  ["{name} is on the way", "{name} va en camino"],
  ["Job funded", "Trabajo pagado"],
  ["Job approved!", "¡Trabajo aprobado!"],
  ["Match for you", "Coincide con usted"],
  ["🌿 Match for you", "🌿 Coincide con usted"],
  ["🧹 Match for you", "🧹 Coincide con usted"],
  ["🚗 Match for you", "🚗 Coincide con usted"],
  ["🛒 Match for you", "🛒 Coincide con usted"],
  ["Warning — keep it on Helpr", "Advertencia: manténgalo en Helpr"],
  ["Your card is saved", "Su tarjeta está guardada"],
  ["Card saved", "Tarjeta guardada"],
  ["Your listing is waiting for a check", "Su anuncio está esperando una revisión"],
  ["Still on for tomorrow?", "¿Sigue en pie para mañana?"],
  ["New message about your order", "Nuevo mensaje sobre su pedido"],
  ["Offer expired", "La oferta venció"],
  ["Offer expired — job reopened", "La oferta venció: el trabajo se abrió de nuevo"],
  ["New job offer", "Nueva oferta de trabajo"],
  ["📋 New job offer!", "📋 ¡Nueva oferta de trabajo!"],
  ["Unread message", "Mensaje sin leer"],
  ["You're both confirmed", "Los dos confirmaron"],
  ["Payout account verified", "Cuenta de pagos verificada"],
  ["Has this job been finished?", "¿Se terminó este trabajo?"],
  ["Did you finish this job?", "¿Terminó este trabajo?"],
  ["Verification Successful", "Verificación exitosa"],
  ["You received a Helpr credit!", "¡Recibió un crédito de Helpr!"],
  ["You're booked for two jobs at the same time", "Tiene dos trabajos a la misma hora"],
  ["{name} confirmed the job", "{name} confirmó el trabajo"],
  ["Job auto-cancelled", "Trabajo cancelado automáticamente"],
  ["Arrival confirmed", "Llegada confirmada"],
  ["✅ Arrival confirmed", "✅ Llegada confirmada"],
  ["Your listings are live", "Sus anuncios están publicados"],
  ["Your listing is live", "Su anuncio está publicado"],
  ["{name} started work", "{name} empezó el trabajo"],
  ["You have a new review", "Tiene una reseña nueva"],
  ["Refund issued: {amount}", "Reembolso hecho: {amount}"],
  ["Starting soon", "Empieza pronto"],
  ["Your job starts in 2 hours", "Su trabajo empieza en 2 horas"],
  ["Revision completed — review needed", "Corrección hecha: falta su revisión"],
  ["{name} will fix it", "{name} lo va a arreglar"],
  ["New jobs in {place}", "Nuevos trabajos en {place}"],
  ["Manually verified", "Verificado a mano"],
  ["You lost a job offer", "Perdió una oferta de trabajo"],
  ["Your job expires soon", "Su trabajo vence pronto"],
  ["New offer", "Nueva oferta"],
  ["Your Helpr hasn't confirmed yet", "Su Helpr todavía no ha confirmado"],
  ["Your Helpr hasn't confirmed today", "Su Helpr no ha confirmado hoy"],
  ["Application update", "Novedad sobre su postulación"],
  ["Dispute sent to Helpr support", "Disputa enviada al equipo de ayuda de Helpr"],
  ["Confirm you'll be there", "Confirme que va a ir"],
  ["Confirm you'll be back today", "Confirme que regresa hoy"],
  ["Finish posting your job", "Termine de publicar su trabajo"],
  ["Finish your job post?", "¿Terminar de publicar su trabajo?"],
  ["Listing sent for review", "Anuncio enviado a revisión"],
  ["Listings sent for review", "Anuncios enviados a revisión"],
  ["Sold: waiting for the buyer to pay", "Vendido: esperando que el comprador pague"],
  ["We've asked support to step in", "Le pedimos al equipo de ayuda que intervenga"],
  ["New review from {name}", "Nueva reseña de {name}"],
  ["Helpr support replied", "El equipo de ayuda de Helpr respondió"],
  ["Back on your job in 2 hours", "Regresa a su trabajo en 2 horas"],
  ["Your Helpr is back in 2 hours", "Su Helpr regresa en 2 horas"],
  ["Verify your ID with Stripe", "Verifique su identidad con Stripe"],
  ["New trade offer", "Nueva oferta de intercambio"],
  ["Finish payout setup to get paid", "Termine de configurar sus pagos para cobrar"],
  ["Reserved for you: check out within {n} minutes", "Reservado para usted: pague en menos de {n} minutos"],
  ["Reserved for you: check out within {n} hours", "Reservado para usted: pague en menos de {n} horas"],
  ["A dispute was opened", "Se abrió una disputa"],
  ["The person who posted this job confirmed it!", "¡La persona que publicó este trabajo lo confirmó!"],
  ["Your applicants are waiting", "Sus postulantes están esperando"],
  ["Start time passed", "Ya pasó la hora de inicio"],
  ["Payout released", "Pago liberado"],
  ["Payout sent!", "¡Pago enviado!"],
  ["New counteroffer", "Nueva contraoferta"],
  ["Your Helpr marked the job done", "Su Helpr marcó el trabajo como terminado"],
  ["Helpr confirmed the job!", "¡El Helpr confirmó el trabajo!"],
  ["Haul-away is open", "El retiro de cosas está abierto"],
  ["Your Helpr is at the job", "Su Helpr está en el trabajo"],
  ["Another day confirmed", "Otro día confirmado"],
  ["Buyer did not check out", "El comprador no pagó"],
  ["Work has started", "El trabajo empezó"],
  ["Payment received", "Pago recibido"],
  ["Verification under review", "Verificación en revisión"],
  ["Delivery coming up", "La entrega se acerca"],
  ["Your Helpr needs another day", "Su Helpr necesita otro día"],
  ["Job continues another day", "El trabajo sigue otro día"],
  ["Dispute decided", "Disputa decidida"],
  ["Dispute settled", "Disputa resuelta"],
  ["Dispute auto-resolved", "Disputa resuelta automáticamente"],
  ["Job disputed", "Trabajo en disputa"],
  ["New request for your free item", "Nueva solicitud para su artículo gratis"],
  ["Payout account required", "Se necesita una cuenta de pagos"],
  ["Pick someone today", "Elija a alguien hoy"],
  ["Someone's buying your item", "Alguien está comprando su artículo"],
  ["You received a tip!", "¡Recibió una propina!"],
  ["{name} tipped you {amount}", "{name} le dio una propina de {amount}"],
  ["Your tip didn't go through", "Su propina no se pudo cobrar"],
  ["Buyer paid", "El comprador pagó"],
  ["Your Helpr confirmed", "Su Helpr confirmó"],
  ["Checkout closed", "El pago se cerró"],
  ["Offer declined", "Oferta rechazada"],
  ["Offer withdrawn", "Oferta retirada"],
  ["New order", "Nuevo pedido"],
  ["Order withdrawn", "Pedido retirado"],
  ["Order sent", "Pedido enviado"],
  ["Order accepted", "Pedido aceptado"],
  ["Your ask ended", "Su solicitud terminó"],
  ["An ask ended", "Una solicitud terminó"],
  ["Back on sale", "De nuevo a la venta"],
  ["The seller answered", "El vendedor respondió"],
  ["New question", "Nueva pregunta"],
  ["Your gift is back", "Su regalo regresó"],
  ["You're hired. Set up payouts to get paid.", "Lo contrataron. Configure sus pagos para cobrar."],
  ["Your new time wasn't answered", "No respondieron a su nueva hora"],
  ["Trade set: choose a pickup within 48 hours", "Intercambio acordado: elija una recogida en menos de 48 horas"],
  ["Trade accepted: choose a pickup within 48 hours", "Intercambio aceptado: elija una recogida en menos de 48 horas"],
  ["New date or time accepted", "Nueva fecha u hora aceptada"],
  ["New date or time requested", "Piden una nueva fecha u hora"],
  ["Handover done", "Entrega hecha"],
  ["Please review the work", "Por favor revise el trabajo"],
  ["Porch pickup day booked", "Día de recogida en el porche reservado"],
  ["It's on the porch: pick it up today", "Está en el porche: recójalo hoy"],
  ["Enjoy your item", "Disfrute su artículo"],
  ["You have a job today", "Tiene un trabajo hoy"],
  ["Please confirm", "Por favor confirme"],
  ["Expired", "Vencido"],

  // ── Messages ──
  ['"{q}" was just posted in {place}.', 'Se acaba de publicar "{q}" en {place}.'],
  ['A new {cat} job was just posted in {place}: "{q}"', 'Se acaba de publicar un trabajo nuevo ({cat}) en {place}: "{q}"'],
  ["Your card is on hold for {amount}. You're only charged when you hire someone.", "Su tarjeta tiene una retención de {amount}. Solo se le cobra cuando contrata a alguien."],
  ['Nobody was hired for "{q}", so the hold on your card was released. Your card was not charged.', 'No se contrató a nadie para "{q}", así que se liberó la retención de su tarjeta. No se le cobró a su tarjeta.'],
  ['{name} cancelled "{q}". Don\'t go.', '{name} canceló "{q}". No vaya.'],
  ['Your payment for "{q}" is safely held and will be released after the job is completed.', 'Su pago por "{q}" está retenido de forma segura y se libera cuando se termine el trabajo.'],
  ['Your payment for "{q}" is safely held in escrow and will release after the job is completed.', 'Su pago por "{q}" está retenido de forma segura y se libera cuando se termine el trabajo.'],
  ['{name} accepted "{q}". You\'re all set.', '{name} aceptó "{q}". Todo listo.'],
  ['{name} has arrived for "{q}". Next: nothing for you to do; they mark it done when they finish.', '{name} llegó para "{q}". Siguiente: usted no tiene que hacer nada; lo marcan como terminado al acabar.'],
  ['{name} has arrived for "{q}"', '{name} llegó para "{q}"'],
  ["Your message was hidden from the other person because it looked like contact info or taking the job off-platform. This is a warning; a second one is a final warning.", "Su mensaje se ocultó a la otra persona porque parecía un dato de contacto o un intento de llevar el trabajo fuera de la app. Esta es una advertencia; la segunda es la advertencia final."],
  ['Take 30 seconds to rate the person who posted this job for "{q}". Reviews help the next person feel safe choosing.', 'Tome 30 segundos para calificar a la persona que publicó "{q}". Las reseñas ayudan a la próxima persona a elegir con confianza.'],
  ['Take 30 seconds to rate your Helpr for "{q}". Reviews help the next person feel safe choosing.', 'Tome 30 segundos para calificar a su Helpr por "{q}". Las reseñas ayudan a la próxima persona a elegir con confianza.'],
  ['Thanks for approving "{q}". Your Helpr is paid {date}.', 'Gracias por aprobar "{q}". A su Helpr se le paga el {date}.'],
  ["Your card is saved. We'll hold {amount} about 4 days before the job, and you're only charged when you hire someone.", "Su tarjeta está guardada. Retendremos {amount} unos 4 días antes del trabajo, y solo se le cobra cuando contrata a alguien."],
  ["Your card is saved. It is charged only when you buy, or automatically where you turned on automatic charges.", "Su tarjeta está guardada. Solo se le cobra cuando compra, o automáticamente donde activó los cobros automáticos."],
  ['{name} is heading to your job: "{q}". Next: nothing for you to do until they arrive.', '{name} va camino a su trabajo: "{q}". Siguiente: no tiene que hacer nada hasta que llegue.'],
  ['{name} is heading to your job: "{q}"', '{name} va camino a su trabajo: "{q}"'],
  ['Someone applied to "{q}"', 'Alguien se postuló a "{q}"'],
  ['{name} applied to "{q}". Next: review and pick a Helpr before it starts {date} at {time}.', '{name} se postuló a "{q}". Siguiente: revise y elija un Helpr antes de que empiece el {date} a las {time}.'],
  ['{name} applied to "{q}". Next: review and pick a Helpr before {date}.', '{name} se postuló a "{q}". Siguiente: revise y elija un Helpr antes del {date}.'],
  ['{name} applied to "{q}". Next: review and pick a Helpr by {date} at {time}.', '{name} se postuló a "{q}". Siguiente: revise y elija un Helpr antes del {date} a las {time}.'],
  ['{name} applied to "{q}"', '{name} se postuló a "{q}"'],
  ['"{q}" was approved. {amount} will be sent to your account {date}, after the one-time {amount2} account setup fee.', '"{q}" fue aprobado. Se enviarán {amount} a su cuenta el {date}, después del cargo único de {amount2} por configurar la cuenta.'],
  ['"{q}" was approved. {amount} will be sent to your account {date}.', '"{q}" fue aprobado. Se enviarán {amount} a su cuenta el {date}.'],
  ["Our automatic check of \"{q}\" didn't finish, so someone from Louisiana Helpr will look at it. Buyers can't see it until then.", 'Nuestra revisión automática de "{q}" no terminó, así que alguien de Louisiana Helpr lo va a revisar. Los compradores no lo ven hasta entonces.'],
  ['Your offer for "{q}" expired without an answer. It\'s open to everyone again.', 'Su oferta para "{q}" venció sin respuesta. Está abierto para todos otra vez.'],
  ["{q2} in {place} · {amount}. Tap to review and apply.", "{q2} en {place} · {amount}. Toque para ver y postularse."],
  ["Your payout account is fully set up! You can now receive payments for completed jobs.", "¡Su cuenta de pagos está lista! Ya puede recibir pagos por los trabajos terminados."],
  ["Your identity has been verified! You're cleared to start using Helpr.", "¡Su identidad fue verificada! Ya puede empezar a usar Helpr."],
  ['"{q}" was cancelled by the person who posted it.', 'La persona que publicó "{q}" lo canceló.'],
  ["{name} sent you a {amount} credit to use toward any job. Tap to redeem it.", "{name} le envió un crédito de {amount} para usar en cualquier trabajo. Toque para usarlo."],
  ["{n} new jobs posted in the last 24 hours — {amount} to {amount2}. Tap to browse.", "{n} trabajos nuevos en las últimas 24 horas: de {amount} a {amount2}. Toque para verlos."],
  ["1 new job posted in the last 24 hours — {amount}. Tap to browse.", "1 trabajo nuevo en las últimas 24 horas: {amount}. Toque para verlo."],
  ['Payment for "{q}" is held.', 'El pago por "{q}" está retenido.'],
  ['Payment for "{q}" is held safely. Get to work!', 'El pago por "{q}" está retenido de forma segura. ¡A trabajar!'],
  ['Payment for "{q}" is now in escrow. Get to work!', 'El pago por "{q}" ya está retenido. ¡A trabajar!'],
  ['Payment for "{q}" is held. Next: confirm you\'ll be there by {date} at {time}.', 'El pago por "{q}" está retenido. Siguiente: confirme que va a ir antes del {date} a las {time}.'],
  ['You\'re both confirmed for "{q}" on {date}.', 'Los dos confirmaron "{q}" para el {date}.'],
  ['"{q}" — its scheduled time has passed and nobody has marked it done. Message your Helpr, or report a problem if something went wrong.', '"{q}": ya pasó la hora programada y nadie lo ha marcado como terminado. Escríbale a su Helpr, o reporte un problema si algo salió mal.'],
  ['"{q}" — its scheduled time has passed. Tap Mark it done so your payment can be released.', '"{q}": ya pasó la hora programada. Toque Marcar como terminado para que se libere su pago.'],
  ['"{q}" — its scheduled time has passed. Tap Mark job complete so your payment can be released.', '"{q}": ya pasó la hora programada. Toque Marcar como terminado para que se libere su pago.'],
  ['"{q}" starts soon — tap to confirm you\'re still on so your Helpr knows it\'s a go.', '"{q}" empieza pronto: toque para confirmar que sigue en pie y su Helpr sepa que va.'],
  ['"{q}" starts soon — tap to confirm you\'re still on. One tap keeps your spot.', '"{q}" empieza pronto: toque para confirmar que sigue en pie. Un toque guarda su lugar.'],
  ['"{q}" starts {date} — tap to confirm you\'re still on. One tap keeps your spot.', '"{q}" empieza el {date}: toque para confirmar que sigue en pie. Un toque guarda su lugar.'],
  ['The seller sent you a message about "{q}".', 'El vendedor le envió un mensaje sobre "{q}".'],
  ['The buyer sent you a message about "{q}".', 'El comprador le envió un mensaje sobre "{q}".'],
  ['{name} confirmed "{q}". Next: confirm your side before {date}.', '{name} confirmó "{q}". Siguiente: confirme de su lado antes del {date}.'],
  ['{name} confirmed you\'ve arrived for "{q}". Next: start the work, and mark it done when you finish.', '{name} confirmó que usted llegó para "{q}". Siguiente: empiece el trabajo y márquelo como terminado al acabar.'],
  ["The seller is waiting on your reply about your order. Next: open the message and reply.", "El vendedor espera su respuesta sobre su pedido. Siguiente: abra el mensaje y responda."],
  ["The seller is still waiting on your reply about your order. Next: open the message and reply.", "El vendedor todavía espera su respuesta sobre su pedido. Siguiente: abra el mensaje y responda."],
  ['{name} started work on "{q}". Next: check it and confirm it\'s done once they mark it done.', '{name} empezó a trabajar en "{q}". Siguiente: revíselo y confirme que está terminado cuando lo marquen.'],
  ['{name} started working on "{q}".', '{name} empezó a trabajar en "{q}".'],
  ['The helpr has fixed the revision for "{q}". You have 72 hours to approve it or open a dispute. If we don\'t hear from you by then, Helpr support will reach out. Your payment stays held until it\'s approved.', 'El Helpr hizo la corrección de "{q}". Tiene 72 horas para aprobarla o abrir una disputa. Si no sabemos de usted para entonces, el equipo de ayuda de Helpr se comunicará. Su pago sigue retenido hasta que lo apruebe.'],
  ['{name} reviewed you for "{q}". It unlocks once you review them too, or in 14 days.', '{name} le dejó una reseña por "{q}". Se muestra cuando usted también le deje una, o en 14 días.'],
  ['{name} saw your fix request on "{q}" and will fix it. Payment stays held until you confirm. Next: confirm it\'s done once it\'s fixed.', '{name} vio su pedido de arreglo en "{q}" y lo va a arreglar. El pago sigue retenido hasta que usted confirme. Siguiente: confirme cuando esté arreglado.'],
  ['"{q}" is live. Buyers can see it now.', '"{q}" está publicado. Los compradores ya lo ven.'],
  ['"{q}" is approved. Buyers can see it now.', '"{q}" está aprobado. Los compradores ya lo ven.'],
  ["{n} listings are live. Buyers can see them now.", "{n} anuncios están publicados. Los compradores ya los ven."],
  ['{name} finished "{q}" and added {n} after photo. Next: review them and approve by {date} at {time}, or Helpr support steps in.', '{name} terminó "{q}" y agregó {n} foto del después. Siguiente: revísela y apruebe antes del {date} a las {time}, o interviene el equipo de ayuda de Helpr.'],
  ['{name} finished "{q}" and added {n} after photos. Next: review them and approve by {date} at {time}, or Helpr support steps in.', '{name} terminó "{q}" y agregó {n} fotos del después. Siguiente: revíselas y apruebe antes del {date} a las {time}, o interviene el equipo de ayuda de Helpr.'],
  ['{name} finished "{q}" and added {n} after photo. Review them and confirm.', '{name} terminó "{q}" y agregó {n} foto del después. Revísela y confirme.'],
  ['{name} has finished "{q}". Please review and confirm.', '{name} terminó "{q}". Por favor revise y confirme.'],
  ['You got a {amount} offer on "{q}". Accept, decline or counter within 48 hours.', 'Recibió una oferta de {amount} por "{q}". Acepte, rechace o haga una contraoferta en menos de 48 horas.'],
  ['You got a {amount} counteroffer on "{q}". Accept, decline or counter within 48 hours.', 'Recibió una contraoferta de {amount} por "{q}". Acepte, rechace o haga una contraoferta en menos de 48 horas.'],
  ["An admin has manually verified your identity. You have full access to Helpr.", "Un administrador verificó su identidad a mano. Tiene acceso completo a Helpr."],
  ['"{q}" starts in under 12 hours and your Helpr hasn\'t confirmed they\'re still on. Message them — or line up a backup while there\'s time.', '"{q}" empieza en menos de 12 horas y su Helpr no ha confirmado que sigue en pie. Escríbale, o busque a otra persona mientras hay tiempo.'],
  ['"{q}" expired: the scheduled time passed with no Helpr hired. You can repost anytime. Your card was not charged.', '"{q}" venció: pasó la hora programada sin contratar a un Helpr. Puede volver a publicarlo cuando quiera. No se le cobró a su tarjeta.'],
  ['"{q}" expires in less than 24 hours with no helpr yet. Boost it to get more visibility!', '"{q}" vence en menos de 24 horas y todavía no tiene Helpr. ¡Destáquelo para que más gente lo vea!'],
  ['The deadline passed on "{q}" when the job started, so it went back to everyone. No strike.', 'El plazo de "{q}" pasó cuando empezó el trabajo, así que volvió a estar abierto para todos. Sin falta.'],
  ['The deadline passed on "{q}" and it went back to everyone. No strike.', 'El plazo de "{q}" pasó y volvió a estar abierto para todos. Sin falta.'],
  ['The dispute on "{q}" was not settled within 72 hours, so Helpr support will decide it. The payment stays on hold until then.', 'La disputa sobre "{q}" no se resolvió en 72 horas, así que la decidirá el equipo de ayuda de Helpr. El pago sigue retenido hasta entonces.'],
  ['Your Helpr didn\'t answer in time for "{q}". It\'s open to everyone again, so you can pick somebody else.', 'Su Helpr no respondió a tiempo para "{q}". Está abierto para todos otra vez, así que puede elegir a otra persona.'],
  ['"{q}" starts in about 30 minutes. Your helpr should be on the way.', '"{q}" empieza en unos 30 minutos. Su Helpr debería ir en camino.'],
  ['"{q}" starts in about 30 minutes. Head out so you arrive on time.', '"{q}" empieza en unos 30 minutos. Salga para llegar a tiempo.'],
  ['"{q}" — your Helpr still hasn\'t marked it done, so your payment is still on hold. Message them, or report a problem and our team will review it.', '"{q}": su Helpr todavía no lo ha marcado como terminado, así que su pago sigue retenido. Escríbale, o reporte un problema y nuestro equipo lo revisará.'],
  ['Your application for "{q}" was not selected', 'Su postulación para "{q}" no fue elegida'],
  ['You got a {n}-star review for "{q}".', 'Recibió una reseña de {n} estrellas por "{q}".'],
  ['{name} picked you for "{q}". Next: accept by {any}, or the offer expires.', '{name} lo eligió para "{q}". Siguiente: acepte antes de {any}, o la oferta vence.'],
  ['"{q}" starts at {time} at {place}. Tap for directions.', '"{q}" empieza a las {time} en {place}. Toque para ver cómo llegar.'],
  ['{name} comes back to finish "{q}" today at {time}.', '{name} regresa hoy a las {time} para terminar "{q}".'],
  ['Your payout for "{q}" has been released to your account.', 'Su pago por "{q}" se liberó a su cuenta.'],
  ['Your offer on "{q}" was declined. Nothing was charged.', 'Su oferta por "{q}" fue rechazada. No se cobró nada.'],
  ['You\'ve been selected for "{q}". Respond within 24 hours or the offer expires.', 'Lo eligieron para "{q}". Responda en menos de 24 horas o la oferta vence.'],
  ['You have a job today at {time}: "{q}".', 'Tiene un trabajo hoy a las {time}: "{q}".'],
  ['You didn\'t pay for "{q}" in time, so it went back up for sale. You were not charged and you get no strike.', 'No pagó "{q}" a tiempo, así que volvió a estar a la venta. No se le cobró y no recibe una falta.'],
  ['We\'re checking "{q}" before buyers see it. We\'ll tell you when it\'s live.', 'Estamos revisando "{q}" antes de que lo vean los compradores. Le avisaremos cuando esté publicado.'],
  ["We couldn't auto-verify your ID. Our team will review it within 24 hours.", "No pudimos verificar su identidad automáticamente. Nuestro equipo la revisará en menos de 24 horas."],
  ['The person who posted this job confirmed you\'ve arrived for "{q}".', 'La persona que publicó este trabajo confirmó que usted llegó para "{q}".'],
  ['The handover of "{q}" is done. If something is wrong with it, you can ask the seller for a refund within 24 hours. Leave the seller a review.', 'La entrega de "{q}" está hecha. Si algo está mal, puede pedirle un reembolso al vendedor en menos de 24 horas. Déjele una reseña al vendedor.'],
  ['The buyer took back their offer on "{q}".', 'El comprador retiró su oferta por "{q}".'],
  ['The buyer paid {amount} for "{q}". You get paid after the handover.', 'El comprador pagó {amount} por "{q}". A usted se le paga después de la entrega.'],
  ['The buyer let "{q}" go before checking out. It\'s back on sale.', 'El comprador dejó "{q}" antes de pagar. Está de nuevo a la venta.'],
  ['The buyer did not pay for "{q}" in time, so it is back up for sale.', 'El comprador no pagó "{q}" a tiempo, así que está de nuevo a la venta.'],
  ['"{q}" sold for {amount}. The buyer has {n} hours to check out and pay.', '"{q}" se vendió por {amount}. El comprador tiene {n} horas para pagar.'],
  ['"{q}" sold for {amount}. The buyer has {n} minutes to check out and pay.', '"{q}" se vendió por {amount}. El comprador tiene {n} minutos para pagar.'],
  ['"{q}" is held for you at checkout for {amount}. Pay within 30 minutes or it goes back up for sale. Your card is not charged until you pay.', '"{q}" está reservado para usted por {amount}. Pague en menos de 30 minutos o vuelve a estar a la venta. No se le cobra a su tarjeta hasta que pague.'],
  ['"{q}" is now on {date} at {time}.', '"{q}" ahora es el {date} a las {time}.'],
  ['"{q}" continues today at {time}.', '"{q}" sigue hoy a las {time}.'],
  ['"{q}" is saved. Pick up where you left off whenever you\'re ready.', '"{q}" está guardado. Siga donde lo dejó cuando quiera.'],
  ['"{q}" hasn\'t sold in 2 weeks. You can book a Helpr to take it to donation or the dump from My listings.', '"{q}" no se ha vendido en 2 semanas. Puede contratar a un Helpr para llevarlo a donar o a la basura desde Mis anuncios.'],
  ['{name} tipped you for a completed job. Thanks for the great work!', '{name} le dio una propina por un trabajo terminado. ¡Gracias por el buen trabajo!'],
  ['{name} hasn\'t checked in for "{q}". Open the job to message them or report a no-show.', '{name} no ha marcado su llegada a "{q}". Abra el trabajo para escribirle o reportar que no llegó.'],
  ['{name} confirmed they\'re committed to "{q}". Tap to confirm your side too.', '{name} confirmó que se compromete con "{q}". Toque para confirmar de su lado también.'],
  ['A dispute was opened on "{q}". The payment is on hold while it is reviewed — add your side so an admin hears both.', 'Se abrió una disputa sobre "{q}". El pago está retenido mientras se revisa: agregue su versión para que un administrador escuche a los dos.'],
  ["Before your next job, verify your ID with Stripe. It takes about 2 minutes.", "Antes de su próximo trabajo, verifique su identidad con Stripe. Toma unos 2 minutos."],
  ['Tap "{q2}" for "{q}". If you haven\'t confirmed 2 hours before it starts, it\'s reposted to other Helprs.', 'Toque "{q2}" para "{q}". Si no confirma 2 horas antes de que empiece, se vuelve a ofrecer a otros Helprs.'],
  ['"{q}" — nobody marked this job done, so our team is reviewing it. The payment stays on hold until a person decides; nothing has been released or refunded.', '"{q}": nadie marcó este trabajo como terminado, así que nuestro equipo lo está revisando. El pago sigue retenido hasta que una persona decida; no se ha liberado ni reembolsado nada.'],
  ['"{q}" — nobody marked this job done, so our team is reviewing it. The payment stays in escrow until a person decides; nothing has been released or refunded.', '"{q}": nadie marcó este trabajo como terminado, así que nuestro equipo lo está revisando. El pago sigue retenido hasta que una persona decida; no se ha liberado ni reembolsado nada.'],
  ['{amount} from "{q}" is ready, but your payout account isn\'t set up yet. Add it in Profile → Payments.', '{amount} de "{q}" ya están listos, pero su cuenta de pagos todavía no está configurada. Agréguela en Perfil → Pagos.'],
  ['Someone is checking out "{q}" for {amount}. It\'s held for them for 30 minutes. We\'ll tell you when they pay.', 'Alguien está pagando "{q}" por {amount}. Se le reserva por 30 minutos. Le avisaremos cuando pague.'],
  ['"{q}" and "{q2}" overlap on {any}. Please get one of them rescheduled: open either job and tap "{name}".', '"{q}" y "{q2}" coinciden el {any}. Cambie la fecha de uno de ellos: abra cualquiera de los dos y toque "{name}".'],
];

const MONTHS: Record<string, string> = {
  Jan: "ene", Feb: "feb", Mar: "mar", Apr: "abr", May: "may", Jun: "jun",
  Jul: "jul", Aug: "ago", Sep: "sept", Oct: "oct", Nov: "nov", Dec: "dic",
};
const DAYS: Record<string, string> = { Mon: "lun", Tue: "mar", Wed: "mié", Thu: "jue", Fri: "vie", Sat: "sáb", Sun: "dom" };
const DATE_RE = "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),? (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \\d{1,2}";

const TOKEN_RE: Record<string, string> = {
  name: "(.+?)", name2: "(.+?)", q: "(.+)", q2: "(.+)", place: "(.+?)", any: "(.+?)", cat: "([a-z_]+)",
  amount: "(\\$[\\d,]+(?:\\.\\d{2})?)", amount2: "(\\$[\\d,]+(?:\\.\\d{2})?)",
  date: `(${DATE_RE})`, time: "(\\d{1,2}:\\d{2} [AP]M)", n: "(\\d+)",
};

/** "Fri, Nov 6" / "Mon Nov 9" -> "vie 6 nov". */
export function dateInSpanish(d: string): string {
  const m = d.match(/^(\w{3}),? (\w{3}) (\d{1,2})$/);
  return m ? `${DAYS[m[1]] ?? m[1]} ${m[3]} ${MONTHS[m[2]] ?? m[2]}` : d;
}

type Compiled = { re: RegExp; tokens: string[]; spanish: string };
let compiled: Compiled[] | null = null;
function compile(): Compiled[] {
  if (compiled) return compiled;
  compiled = NOTICE_SHAPES.map(([english, spanish]) => {
    const tokens: string[] = [];
    const body = english
      .split(/(\{[a-z0-9]+\})/)
      .map((part) => {
        const tok = part.match(/^\{([a-z0-9]+)\}$/)?.[1];
        if (tok && TOKEN_RE[tok]) {
          tokens.push(tok);
          return TOKEN_RE[tok];
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("");
    return { re: new RegExp(`^${body}$`), tokens, spanish };
  });
  return compiled;
}

/** A server-written notice's title or message in Spanish, or the English unchanged when no known shape matches. */
export function noticeInSpanish(text: string): string {
  if (!text) return text;
  for (const { re, tokens, spanish } of compile()) {
    const m = text.match(re);
    if (!m) continue;
    const vals: Record<string, string> = {};
    tokens.forEach((tok, i) => {
      vals[tok] = tok === "date" ? dateInSpanish(m[i + 1]) : m[i + 1];
    });
    return spanish.replace(/\{([a-z0-9]+)\}/g, (all, tok: string) => vals[tok] ?? all);
  }
  return text;
}
