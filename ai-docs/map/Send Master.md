# MAP/Send Master

## Send Master/
- gerenciamento-emails-avancado.php [224L] Description: Sistema completo e independente de gerenciamento de e-mails para Wo — hook:site_transient_update_plugins, hook:plugins_loaded, hook:admin_notices, hook:init, hook:admin_init, hook:admin_notices, hook:admin_notices, hook:admin_menu, ge_advanced_admin_menu()

## Send Master/assets/css/
- admin-enhanced.css [660L] Gerenciamento de E-mails - CSS Avançado */
- flow-studio.css [698L]
- ge-modern-admin.css [351L] Modern Palette - Indigo & Emerald Theme */
- landing-page-builder.css [750L] Landing Page Builder - Construtor Visual de E-mails */
- license-admin.css [132L] Estilos para a página de licença SendMaster */
- public-forms.css [131L]
- sendmaster-app.css [419L]
- smtp-config.css [439L] CSS para Configurações SMTP - E-mails Avançado
- visual-form-builder.css [223L] Visual Form Builder Styles */

## Send Master/assets/js/
- admin-enhanced-fixed.js [1657L] Verificar se o objeto AJAX existe
- flow-builder-simple.js [983L] Flow Builder Simplificado - JavaScript Vanilla — SimpleFlowBuilder
- flow-studio-linear.js [1866L] Force wait for DOM
- form-builder.js [252L] Only run if on the forms tab
- ge-heartbeat.js [60L] SendMaster Heartbeat
- ge-pixel.js [163L] Configurações padrão (serão atualizadas via comando 'init')
- ge-tracking.js [41L] Use sendBeacon if available for better reliability on unload,
- landing-page-builder.js [2956L] Landing Page Builder - Construtor Visual de E-mails
- license-admin.js [140L] Fluxo de licença da página de administração do SendMaster
- public-forms.js [174L] 1. MutationObserver: Vigia o DOM para detectar quando um Popup insere o formulár
- smtp-config.js [132L] Tab Navigation
- user-management.js [864L] Gerenciamento de Usuários - Sistema de Tags e Analytics
- visual-form-builder.js [538L] Visual Form Builder — VisualFormBuilder

## Send Master/includes/
- admin-page.php [178L] Identificar página atual (Menu Principal ou Submenu de Licença) — ge_advanced_admin_page(), loadAvailableTags()
- admin-smtp-page.php [545L] Verificação de licença antes de renderizar — ge_advanced_smtp_page(), toggleSmtpFieldsInline()
- admin.php [246L] Security Checks — ge_advanced_process_campaign(), ge_advanced_save_welcome_settings()
- assets.php [126L] Cleanup: Removing references to legacy builders — ge_advanced_enqueue_assets(), ge_advanced_frontend_assets(), hook:admin_enqueue_scripts, hook:wp_enqueue_scripts
- cache.php [16L] — ge_advanced_clear_all_cache()
- class-ge-advanced-api-endpoint.php [143L] Endpoint REST para desativação remota da licença SendMaster — GE_Advanced_API_Endpoint, get_instance(), __construct(), hook:rest_api_init, register_routes(), rest:sendmaster/v1/deactivate_license, remote_deactivate(), normalize_sid()
- class-ge-advanced-config.php [258L] Configurações de Licenciamento do SendMaster — GE_Advanced_Config, api_base(), api_key(), product_name(), product_version(), system_id(), webhook_secret(), error_messages(), is_license_active(), build_license_signature(), verify_license_signature(), block_ajax_if_license_inactive(), +11
- class-ge-advanced-feature-blocker.php [49L] Bloqueio de funcionalidades quando a licença não está ativa — GE_Advanced_Feature_Blocker, get_instance(), __construct(), hook:admin_notices, hook:init, is_active(), show_license_notice(), maybe_disable_runtime()
- class-ge-advanced-license.php [532L] Handles verify/check/deactivate flows against remote API and persists local stat — GE_Advanced_License, get_instance(), __construct(), init_hooks(), hook:wp_ajax_ge_advanced_license_verify, hook:wp_ajax_ge_advanced_license_check, hook:wp_ajax_ge_advanced_check_local, hook:wp_ajax_ge_advanced_license_deactivate, hook:wp_ajax_ge_advanced_test_connection, hook:admin_post_ge_advanced_license_deactivate, hook:admin_init, hook:ge_advanced_daily_license_check, +16
- class-sendmaster-app.php [351L] Janela do SendMaster com menu lateral na mesma tela do conteúdo. — GE_SendMaster_App, init(), hook:query_vars, hook:init, hook:init, hook:template_redirect, hook:admin_init, hook:admin_head, hook:admin_head, hook:admin_body_class, hook:admin_footer, hook:admin_footer, +25
- cli.php [292L]
- cron.php [803L] — ge_advanced_schedule_events(), ge_advanced_add_cron_interval(), hook:cron_schedules, ge_advanced_tick(), hook:ge_advanced_tick, ge_advanced_backfill_step_totals(), hook:ge_advanced_backfill_step_totals, hook:init, ge_advanced_process_queue_function(), hook:ge_advanced_process_queue, ge_advanced_process_active_flows(), hook:ge_advanced_check_flows, +6
- db.php [310L] — ge_advanced_create_tables(), ge_advanced_ensure_flow_progress_table(), ge_advanced_insert_sample_templates(), ge_advanced_ensure_templates_table(), hook:init
- default-templates.php [47L] — ge_advanced_get_sample_templates()
- dependencies.php [29L] Includes de lógica backend
- flows.php [1454L] — ge_advanced_add_flow_log(), ge_advanced_step_totals_table(), ge_advanced_ensure_step_totals_table(), ge_advanced_bump_step_total(), hook:ge_advanced_tag_added, hook:ge_advanced_lead_captured, hook:user_register, ge_advanced_trigger_flows_by_tag(), ge_advanced_trigger_flows_by_form(), ge_advanced_trigger_flows_by_page(), ge_advanced_page_target_matches(), ge_advanced_trigger_flows_by_registration(), +20
- forms.php [501L] Shortcode Handler — shortcode:ge_form, ge_advanced_render_form_shortcode(), hook:wp_ajax_ge_advanced_submit_form, hook:wp_ajax_nopriv_ge_advanced_submit_form, ge_advanced_submit_form(), ge_advanced_form_tags_from_settings(), ge_advanced_confirm_table(), ge_advanced_ensure_confirm_table(), ge_advanced_send_double_optin(), ge_advanced_handle_double_optin()
- hooks.php [493L] — ge_advanced_activate(), ge_advanced_allow_svg_in_tinymce(), hook:tiny_mce_before_init, ge_advanced_disable_emojis_in_emails(), hook:emoji_svg_url, hook:tiny_mce_plugins, hook:admin_enqueue_scripts, hook:admin_footer, hook:init, ge_advanced_disable_tinymce_emoji(), ge_advanced_stop_admin_emoji(), ge_advanced_restore_native_emoji(), +24
- smtp.php [448L] Hook global para configurar SMTP (Standard) — hook:phpmailer_init, hook:pre_wp_mail, ge_advanced_configure_phpmailer(), hook:wp_mail, ge_advanced_get_unsub_headers(), ge_advanced_inject_unsub_header_global(), ge_advanced_api_mailer_handler(), ge_advanced_send_email()
- tracking.php [751L] — ge_advanced_html_to_text(), ge_advanced_email_has_visible_body(), ge_advanced_click_links_table(), ge_advanced_click_links_ensure_tag_column(), ge_advanced_register_click_link(), ge_advanced_rewrite_click_links(), ge_advanced_mark_clicked(), ge_advanced_redirect_short_click(), ge_advanced_render_vote_confirmation(), ge_advanced_add_tracking(), ge_advanced_open_is_automated(), ge_advanced_automated_open_sql(), +5
- webhook.php [428L] Webhook Handler para Bounces e Spam Reports — hook:rest_api_init, rest:ge-advanced/v1/webhook, rest:ge-advanced/v1/webhook/(?P<hook_id>[a-zA-Z0-9-_]+), ge_advanced_ensure_webhook_token(), ge_advanced_webhook_public_url(), ge_advanced_webhook_is_authorized(), ge_advanced_handle_dynamic_webhook(), ge_advanced_handle_webhook_sale(), ge_advanced_extract_field(), ge_advanced_ensure_tag_exists(), ge_advanced_add_user_tag(), ge_advanced_handle_webhook(), +1

## Send Master/includes/admin-tabs/
- campaign.php [103L] — ge_advanced_render_tab_campaign()
- dashboard.php [221L] — ge_advanced_render_tab_dashboard(), loadDashboardData(), renderRecentActivity(), updateStatusBadge()
- flows.php [216L] — ge_advanced_render_tab_flows(), loadDebugPanel()
- forms.php [130L] — ge_advanced_render_tab_forms(), toggleSuccessOptions(), closeEmbedModal(), copyToClipboard()
- license.php [184L] Pass localization data to JS — ge_advanced_render_tab_license(), hook:admin_footer
- pixel.php [190L] — ge_advanced_render_tab_pixel(), copyPixelCode(), loadPixelLogs()
- queue.php [29L] — ge_advanced_render_tab_queue()
- reports.php [127L] — ge_advanced_render_tab_reports()
- tags.php [176L] — ge_advanced_render_tab_tags()
- templates.php [158L] — ge_advanced_render_tab_templates(), openLandingBuilder(), switchToTemplatesList(), selectBuilder()
- users.php [42L] — ge_advanced_render_tab_users()
- webhooks.php [515L] 1. Processar Ações (Salvar/Excluir) — ge_advanced_render_tab_webhooks(), toggleSmartRouting(), ge_advanced_flatten_json(), showCopyFeedback()
- welcome.php [48L] — ge_advanced_render_tab_welcome()

## Send Master/includes/ajax/
- dashboard.php [116L] 1. Total Leads — hook:wp_ajax_ge_advanced_get_dashboard_stats, ge_advanced_get_dashboard_stats()
- flows-get.php [140L] — ge_advanced_get_flows()
- flows-save.php [93L] Check Nonce — ge_advanced_save_flow_data()
- flows.php [523L] Include separate handler files — hook:wp_ajax_ge_advanced_save_flow, hook:wp_ajax_ge_advanced_get_flows, hook:wp_ajax_ge_advanced_save_flow_data, hook:wp_ajax_ge_save_flow_data, hook:wp_ajax_ge_advanced_execute_flow, hook:wp_ajax_ge_advanced_get_flow_status, hook:wp_ajax_ge_advanced_control_user_flow, hook:wp_ajax_ge_advanced_get_flow_logs, hook:wp_ajax_ge_advanced_clear_flow_logs, hook:wp_ajax_ge_advanced_trigger_flows_manual, hook:wp_ajax_ge_advanced_force_trigger_flows, hook:wp_ajax_ge_advanced_toggle_welcome, +20
- forms.php [179L] New Visual Builder Format — ge_advanced_save_form(), hook:wp_ajax_ge_advanced_save_form, ge_advanced_get_forms(), hook:wp_ajax_ge_advanced_get_forms, ge_advanced_get_form(), hook:wp_ajax_ge_advanced_get_form, ge_advanced_delete_form(), hook:wp_ajax_ge_advanced_delete_form, ge_advanced_get_form_code(), hook:wp_ajax_ge_advanced_get_form_code
- pages.php [23L] — ge_advanced_get_pages_list(), hook:wp_ajax_ge_advanced_get_pages_list
- queue.php [16L] — hook:wp_ajax_ge_advanced_get_queue, ge_advanced_get_queue()
- reports.php [459L] — hook:wp_ajax_ge_advanced_get_reports, hook:wp_ajax_ge_advanced_database_diagnostic, hook:wp_ajax_ge_advanced_get_stats, hook:wp_ajax_ge_advanced_insert_test_data, hook:wp_ajax_ge_advanced_insert_sample_data, hook:wp_ajax_ge_advanced_test_auto_trigger, hook:wp_ajax_ge_advanced_clear_cache, hook:wp_ajax_ge_advanced_check_cron_status, hook:wp_ajax_ge_advanced_reschedule_cron, hook:wp_ajax_ge_advanced_get_campaigns_list, hook:wp_ajax_ge_advanced_test_smtp, hook:wp_ajax_ge_advanced_send_test, +16
- templates.php [310L] — ge_advanced_ajax_get_templates(), ge_advanced_ajax_get_template(), ge_advanced_ajax_save_template(), ge_advanced_ajax_delete_template(), ge_advanced_ajax_duplicate_template(), ge_advanced_ajax_upload_media(), ge_advanced_ajax_load_template_builder(), ge_advanced_ajax_save_builder_state(), ge_advanced_ajax_preview_template(), hook:wp_ajax_ge_advanced_get_templates, hook:wp_ajax_ge_advanced_get_template, hook:wp_ajax_ge_advanced_save_template, +11
- tracking.php [119L] No nonce check here because it's a public frontend hit, and we rely on the cooki — ge_advanced_track_page_visit(), hook:wp_ajax_ge_advanced_track_page_visit, hook:wp_ajax_nopriv_ge_advanced_track_page_visit, ge_advanced_get_pixel_logs(), hook:wp_ajax_ge_advanced_get_pixel_logs, ge_advanced_clear_pixel_logs(), hook:wp_ajax_ge_advanced_clear_pixel_logs
- users.php [812L] — hook:wp_ajax_ge_advanced_get_wp_users, hook:wp_ajax_ge_advanced_get_users, hook:wp_ajax_ge_advanced_save_user_tags, hook:wp_ajax_ge_advanced_manage_user_tag, hook:wp_ajax_ge_advanced_get_user_tags, hook:wp_ajax_ge_advanced_get_all_tags, hook:wp_ajax_ge_advanced_create_tag, hook:wp_ajax_ge_advanced_delete_tag, hook:wp_ajax_ge_advanced_sync_system_tags, hook:wp_ajax_ge_advanced_create_tables, ge_advanced_get_wp_users(), ge_advanced_sync_system_tags(), +27

## Send Master/includes/api/
- class-ge-pixel-api.php [132L] API REST para o Pixel de Rastreamento Externo — GE_Advanced_Pixel_API, __construct(), hook:rest_api_init, register_routes(), rest:ge-advanced/v1/pixel/track, hook:rest_pre_serve_request, send_cors_headers(), handle_track_event(), visits_table_ready(), log_page_visit(), visits_table_exists()

## Send Master/includes/providers/
- class-ge-mailer-abstract.php [171L] Classe Abstrata para Envios via API — GE_Mailer_Abstract, __construct(), process_phpmailer(), ensure_unsubscribe_headers(), send(), process_response(), get_error(), set_headers(), set_reply_to(), get_headers(), get_body()
- class-ge-mailer-brevo.php [109L] Provedor Brevo (Antigo Sendinblue) — GE_Mailer_Brevo, __construct(), set_from(), set_recipients(), set_subject(), set_content(), set_reply_to(), set_headers()
- class-ge-mailer-elastic.php [81L] Provedor Elastic Email — GE_Mailer_Elastic, __construct(), set_from(), set_recipients(), set_subject(), set_content(), format_address()
- class-ge-mailer-mailersend.php [90L] Provedor MailerSend — GE_Mailer_MailerSend, __construct(), set_from(), set_recipients(), set_subject(), set_content(), set_reply_to()
- class-ge-mailer-mailgun.php [128L] Provedor Mailgun (API v3) — GE_Mailer_Mailgun, __construct(), set_from(), set_recipients(), set_subject(), set_content(), set_headers(), set_reply_to()
- class-ge-mailer-mailjet.php [93L] Provedor Mailjet (API v3.1) — GE_Mailer_Mailjet, __construct(), set_from(), set_recipients(), set_subject(), set_content(), set_reply_to()
- class-ge-mailer-mandrill.php [80L] Provedor Mandrill — GE_Mailer_Mandrill, __construct(), set_from(), set_recipients(), set_subject(), set_content(), set_reply_to()
- class-ge-mailer-postmark.php [93L] Provedor Postmark — GE_Mailer_Postmark, __construct(), set_from(), set_recipients(), set_subject(), set_content(), set_reply_to()
- class-ge-mailer-resend.php [76L] Provedor Resend — GE_Mailer_Resend, __construct(), set_from(), set_recipients(), set_subject(), set_content(), set_reply_to()
- class-ge-mailer-sendgrid.php [95L] Provedor SendGrid — GE_Mailer_SendGrid, __construct(), set_from(), set_recipients(), set_subject(), set_content(), set_headers()
- class-ge-mailer-sendlayer.php [95L] Provedor SendLayer — GE_Mailer_SendLayer, __construct(), set_from(), set_recipients(), set_subject(), set_content(), set_reply_to()
- class-ge-mailer-smtp2go.php [88L] Provedor SMTP2GO — GE_Mailer_SMTP2GO, __construct(), set_from(), set_recipients(), set_subject(), set_content(), set_reply_to(), format_address()
- class-ge-mailer-smtpcom.php [119L] Provedor SMTP.com — GE_Mailer_SMTPcom, __construct(), set_from(), set_recipients(), set_subject(), set_content(), set_reply_to()
- class-ge-mailer-sparkpost.php [107L] Provedor SparkPost — GE_Mailer_SparkPost, __construct(), set_from(), set_recipients(), set_subject(), set_content(), set_reply_to()
