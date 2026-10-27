-- ============================================================================
-- seed.sql — demo data for local development.
-- Safe to re-run: it deletes the demo business first, then recreates it.
-- NEVER run this against a production project.
-- ============================================================================

-- A fixed UUID so scripts and .env can point at it directly.
delete from public.businesses where id = 'a1b2c3d4-0000-4000-8000-000000000001';

insert into public.businesses
  (id, name, slug, business_type, description, location, timezone, currency,
   hours, chat_slug, chat_greeting, chat_accent,
   owner_name, owner_phone, owner_email, agent_persona)
values (
  'a1b2c3d4-0000-4000-8000-000000000001',
  'Pulse Fitness Studio',
  'pulse-fitness',
  'gym',
  'A neighbourhood gym and fitness studio offering strength training, cardio, '
  'group classes and personal training, with certified trainers and separate '
  'timings for women.',
  'Gachibowli, Hyderabad',
  'Asia/Kolkata',
  'INR',
  '[{"day":0,"open":"07:00","close":"13:00","closed":false},
    {"day":1,"open":"05:30","close":"22:00","closed":false},
    {"day":2,"open":"05:30","close":"22:00","closed":false},
    {"day":3,"open":"05:30","close":"22:00","closed":false},
    {"day":4,"open":"05:30","close":"22:00","closed":false},
    {"day":5,"open":"05:30","close":"22:00","closed":false},
    {"day":6,"open":"06:00","close":"20:00","closed":false}]'::jsonb,
  'pulse-fitness',
  'Hi! I''m the Pulse Fitness assistant. Ask me about memberships, timings, '
  'classes or trainers.',
  'indigo',
  'Rahul Verma',
  '+919502542919',          -- CHANGE to your number if you want owner alerts
  'arudraar2023@gmail.com',
  'Be warm, brief and encouraging. Use simple English. Never promise a discount '
  'or waive a fee — say you will have someone from the team confirm. Never give '
  'medical, injury or diet advice; hand those to a human trainer.'
);

-- ------------------------------------------------------------ agent access
insert into public.agent_subscriptions (business_id, agent_key, is_active, settings)
values
  ('a1b2c3d4-0000-4000-8000-000000000001', 'customer_support', true,
   '{"allow_callbacks": true, "max_steps": 6}'::jsonb),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'booking', false, '{}'::jsonb),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'payment', false, '{}'::jsonb);

-- ---------------------------------------------------------------- services
insert into public.business_services
  (business_id, name, description, duration_minutes, price, price_note, sort_order)
values
  ('a1b2c3d4-0000-4000-8000-000000000001', 'Monthly Membership',
   'Full gym access, all equipment, open gym hours.', 0, 1800, 'per month', 1),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'Quarterly Membership',
   'Three months of full gym access. Works out cheaper than monthly.', 0, 4800, 'for 3 months', 2),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'Annual Membership',
   'Twelve months of full access, includes one free month freeze.', 0, 15000, 'per year', 3),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'Personal Training',
   'One-on-one sessions with a certified trainer, booked in packs of 12.', 60, 9000, 'for 12 sessions', 4),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'Group Classes Add-on',
   'Unlimited Zumba, HIIT and yoga classes on top of any membership.', 45, 800, 'per month', 5),
  ('a1b2c3d4-0000-4000-8000-000000000001', 'Day Pass',
   'Single day access for visitors.', 0, 250, 'per day', 6);

-- ------------------------------------------------------------ knowledge base
insert into public.knowledge_articles (business_id, title, body, tags) values
  ('a1b2c3d4-0000-4000-8000-000000000001',
   'Is there a free trial?',
   'Yes. First-time visitors get one free trial session. Just walk in with a photo ID and ask at the front desk. The trial does not include personal training or group classes.',
   '{trial,free,new}'),

  ('a1b2c3d4-0000-4000-8000-000000000001',
   'Can I freeze or pause my membership?',
   'Quarterly and annual members can freeze their membership for up to 30 days in a year, in blocks of at least 7 days. Monthly memberships cannot be frozen. Freeze requests must be made at the front desk before the pause starts, not afterwards.',
   '{freeze,pause,hold,membership}'),

  ('a1b2c3d4-0000-4000-8000-000000000001',
   'Are there separate timings for women?',
   'Yes. The studio floor is reserved for women from 11 AM to 1 PM, Monday to Saturday. Outside those hours the gym is mixed. Women trainers are available on request.',
   '{women,ladies,timings,safety}'),

  ('a1b2c3d4-0000-4000-8000-000000000001',
   'What are the group class timings?',
   'Zumba runs Monday, Wednesday and Friday at 7 PM. HIIT runs Tuesday and Thursday at 6:30 PM. Yoga runs Saturday and Sunday at 8 AM. Classes need the Group Classes add-on and a spot reserved at the front desk on the day.',
   '{classes,zumba,hiit,yoga,timings}'),

  ('a1b2c3d4-0000-4000-8000-000000000001',
   'Do you have parking?',
   'Yes, free two-wheeler and four-wheeler parking in the basement, accessible from the rear gate on the service road.',
   '{parking,location,directions}'),

  ('a1b2c3d4-0000-4000-8000-000000000001',
   'What payment methods do you accept?',
   'Cash, all UPI apps, credit and debit cards. Annual memberships can be split into three instalments — ask the front desk to set that up.',
   '{payment,upi,card,instalment}'),

  ('a1b2c3d4-0000-4000-8000-000000000001',
   'Can I transfer my membership to someone else?',
   'Memberships are personal and cannot be transferred. Annual members may transfer once to an immediate family member, with proof of relationship and a one-time 500 rupee fee.',
   '{transfer,membership,rules}'),

  ('a1b2c3d4-0000-4000-8000-000000000001',
   'Is there a refund if I cancel?',
   'Memberships are non-refundable once activated. If you cancel within 3 days of joining and have used the gym at most twice, the manager can approve a partial refund. This always needs manager approval.',
   '{refund,cancel,money}'),

  ('a1b2c3d4-0000-4000-8000-000000000001',
   'What should I bring on my first day?',
   'Comfortable workout clothes, non-marking sports shoes, a towel and a water bottle. Lockers are free but bring your own lock. A photo ID is needed for registration.',
   '{first,new,joining,what to bring}'),

  ('a1b2c3d4-0000-4000-8000-000000000001',
   'Do you have certified trainers?',
   'Yes. All floor trainers hold either an ACE or a K11 certification, and two of our personal trainers are also certified in sports nutrition.',
   '{trainers,certification,personal training}');

-- --------------------------------------------------------------- confirm it
select
  (select count(*) from public.businesses)          as businesses,
  (select count(*) from public.business_services)   as services,
  (select count(*) from public.knowledge_articles)  as articles,
  (select count(*) from public.agent_subscriptions) as subscriptions;