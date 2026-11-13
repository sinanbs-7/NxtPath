In many rural villages, students depend on a limited number of government buses to travel to schools and colleges. But what happens when buses are unavailable, routes are disrupted, or transportation demand exceeds the available capacity? In this challenge, participants must use AI tools and prompt engineering to develop an innovative solution that addresses transportation difficulties faced by rural students. The goal is to rethink how limited transportation resources can be managed, how students can find alternative ways to reach their educational institutions, and how technology can make rural transportation more accessible and efficient. There are no restrictions on what participants can build. It could be a smart transportation platform, intelligent bus allocation system, route optimization tool, demand prediction system, interactive simulation, or an entirely new concept. The solution should demonstrate creativity, practical problem-solving, and effective use of AI.
\
Tell the AI what it is building.\
\
2\. Problem What real-world problem are you solving?\
3\. Users Who will use the app?\
4\. Core features List exactly what the app must do.\
5\. User flow Explain what happens from opening the app → completing the task.\
6\. UI/UX Describe the visual style and important screens.\
7\. Tech requirements Specify frontend, backend, database, APIs, authentication, AI, etc.\
8\. Demo data Tell it to create realistic sample data so the app works immediately.\
9\. Hackathon requirements Mention what must be impressive during the demo.\
\
Reliability\
The application must:\
Actually work end-to-end\
Handle invalid inputs\
Show useful error messages\
Avoid broken buttons\
Avoid placeholder functionality\
Work without requiring complicated setup










Build a complete, polished, mobile-first web application called **NXTPATH: Rural Student Transport Rescue Network**.

## 1. What you are building

NXTPATH  is an intelligent rural student transportation platform. It helps students reach school or college when their regular government bus is late, cancelled, overcrowded, or affected by road disruption.

The platform must do two things:

1. Help an individual student quickly find the safest, most affordable alternate journey.
2. Help schools and transport authorities identify stranded students, predict overcrowding, and allocate limited vehicles more intelligently.

This is a hackathon-ready, fully functional demo product. Build real workflows, persistent data, calculations, validations, and usable screens—not static mockups.

## 2. Problem

Rural students often depend on one or two government buses to reach educational institutions. When a bus fails to arrive, is full, breaks down, or a road is blocked, students may miss classes or exams.

There is no simple way for students to know:

- Whether their bus is delayed or cancelled.
- Which nearby students have the same problem.
- Whether a safe alternate bus, shared auto, school van, or verified ride is available.
- Whether their school knows that many students are stranded.
- Which villages and routes need more transport capacity.

The app must make limited rural transport resources visible, organized, safe, and easier to share.

## 3. Users

Create role-based experiences for these five user types:

1. **Student** — checks bus status, reports disruption, requests an alternate journey, joins a commute group.
2. **Parent/Guardian** — views a student’s journey plan and gives consent for shared travel.
3. **Verified Driver** — offers available seats in an approved vehicle or shared auto.
4. **School Transport Coordinator** — monitors stranded students and creates emergency transport actions.
5. **Transport Administrator** — reviews demand patterns, capacity shortages, and allocation recommendations.

Include a simple demo role selector on first launch so the app can be explored without complicated registration.

## 4. Core features

Build exactly these core features:

1. **Bus status reporting**  
   Students can report “Bus late,” “Bus did not arrive,” “Bus is full,” “Road blocked,” or “Vehicle breakdown.”

2. **Emergency journey request**  
   A student enters their village, destination school/college, desired arrival time, number of travellers, and accessibility needs.

3. **AI Journey Rescue Plan**  
   Generate and rank alternate travel options using safety, estimated arrival time, cost, seat availability, reliability, and walking distance.

4. **Student commute pods**  
   Group nearby students travelling in the same direction so they can use shared autos, school vans, alternate buses, or supervised walking-to-stop routes.

5. **Verified ride availability**  
   Drivers can publish a route, departure time, available seats, pickup location, and cost. Only verified drivers are available for student recommendations.

6. **Stranding detection and school alerts**  
   Detect a likely transport emergency when multiple students report disruptions from the same village or route. Notify the school dashboard automatically.

7. **Demand prediction and bus allocation recommendations**  
   Show which routes are likely to be overcrowded based on day, historical rider counts, school events, weather condition, and previous disruptions.

8. **“What-if” transport simulation**  
   Let a coordinator simulate an event such as “Bus B-102 is cancelled” and show affected students, capacity shortages, and recommended rescue resources.

## 5. User flow

### Student flow

1. Student opens the app and chooses the Student demo role.
2. The home screen shows today’s usual bus, live status, and a large “My Bus Has a Problem” button.
3. The student reports a disruption or taps “Plan My Journey.”
4. The student selects village, destination, arrival time, and travel needs.
5. The app validates all required information and shows useful messages for missing or invalid data.
6. The AI Journey Rescue Plan appears with the best three options.
7. Each option clearly shows:
   - estimated arrival time
   - total cost
   - number of available seats
   - walking distance
   - safety score
   - reliability score
   - explanation of why it is recommended
8. The student selects an option and can join a commute pod or request a seat.
9. The app confirms the trip, creates an in-app notification, and updates the school coordinator dashboard.

### School coordinator flow

1. Coordinator opens the dashboard.
2. They see active incidents, villages with stranded students, predicted attendance risk, and available emergency vehicles.
3. They open a stranding event.
4. The app displays the affected students, available alternate transport, and an AI-generated recommended plan.
5. The coordinator can assign a school van or approve a verified shared vehicle.
6. Assigned students receive an in-app journey confirmation.

### Transport administrator flow

1. Administrator opens the demand dashboard.
2. They view route demand, overcrowding risk, disruptions, and village-level travel demand.
3. They run a “What if a bus is cancelled?” simulation.
4. The app calculates affected riders and recommends vehicle reassignment or additional trips.

## 6. UI/UX

Use a warm, trustworthy, accessible visual style inspired by rural communities and public services.

Visual direction:

- Primary colors: deep green, warm saffron/orange, sky blue, and off-white.
- Use large buttons, simple icons, high-contrast labels, and easy-to-read typography.
- Make the app usable on low-end Android phones.
- Use plain English with wording that is easy to translate into local languages later.
- Avoid dense dashboards for students; use cards, clear status badges, and step-by-step actions.
- Use red only for emergencies, amber for delays, green for confirmed safe journeys, and blue for information.

Important screens:

1. Welcome and role selector.
2. Student home screen.
3. Report transport problem screen.
4. Emergency journey request form.
5. AI Journey Rescue Plan results screen.
6. Commute pod and seat-request screen.
7. Driver ride availability screen.
8. School coordinator incident dashboard.
9. Transport administrator demand dashboard.
10. What-if simulation screen.
11. Notifications screen.
12. Profile and safety verification screen.

Use a simple illustrated village-route map made inside the app. Do not depend on a paid external map service for the demo.

## 7. Technical requirements

Build this as a complete full-stack web application.

Frontend:

- React with TypeScript.
- Responsive, mobile-first layout.
- Tailwind CSS and polished reusable UI components.
- Accessible forms, loading states, empty states, success states, and error states.

Backend and database:

- Use Supabase for authentication, database, row-level security, and persistence.
- Create tables for users, students, guardians, schools, villages, bus routes, bus trips, disruption reports, vehicles, driver availability, commute pods, seat requests, alerts, demand forecasts, and simulations.
- Use role-based permissions so students cannot access administrator-only information.

Authentication:

- Provide demo access without requiring sign-up.
- Also include optional email/password login for real users.
- Seed demo accounts for every role.

AI and decision engine:

- Create an intelligent recommendation engine that ranks travel options using:
  - safety
  - verified-driver status
  - available seats
  - estimated travel time
  - cost
  - walking distance
  - arrival deadline
  - route reliability
- Use deterministic scoring so recommendations work immediately even if an AI API key is unavailable.
- Add an optional AI assistant integration for natural-language explanations, such as: “Why was this route recommended?” and “What should I do if my bus does not arrive?”
- The app must never recommend an unverified driver for a student unless guardian or school approval is recorded.

Reliability requirements:

- Every clickable button must work.
- Do not include dead links, fake controls, placeholder pages, or unfinished actions.
- Validate form fields before submission.
- Display useful error messages, such as “Please select your destination,” “Arrival time must be in the future,” or “No safe transport option is currently available.”
- Show helpful empty states when no rides or students are found.
- Prevent duplicate seat bookings and prevent booking more seats than are available.
- Use loading indicators during data actions.
- Make the system work immediately with seeded demo data and no complicated setup.

## 8. Demo data

Create realistic, interconnected seed data that makes the app usable immediately.

Create:

- 6 villages: Rampur, Kheda, Sonapur, Bhairavpur, Lakshmi Nagar, and Devgaon.
- 3 institutions: Government Degree College, Rural Girls High School, and District Polytechnic.
- 8 bus routes, each with route number, stops, capacity, departure time, estimated fare, and current status.
- 300 students distributed across villages and institutions.
- 20 verified drivers with autos, vans, and shared jeeps.
- 5 school emergency vans.
- 25 active commute pods.
- Historical passenger demand for the past 30 days.
- At least 12 realistic disruption events, including late buses, breakdowns, road blocks, rain, overcrowding, and cancelled trips.
- At least one active demo incident: Bus B-102 from Rampur to Government Degree College is cancelled, leaving 42 students at risk of being late.
- Alternative transport options for that incident, including an alternate bus stop, two verified shared autos, and one school van.

Include realistic names, times, prices in Indian rupees, vehicle capacities, and route distances.

## 9. Hackathon demo requirements

The app must be impressive in a live demo within three minutes.

Create a prominent demo scenario named:

**“Monsoon Morning: Bus B-102 Cancelled”**

During the demo, the presenter must be able to:

1. Open the Student role.
2. Report that Bus B-102 did not arrive.
3. Receive a clear AI rescue plan.
4. Join a commute pod or request an available seat.
5. Switch to the School Coordinator role.
6. See the system detect that 42 students are stranded.
7. View an actionable AI recommendation to allocate one school van and two verified shared autos.
8. Switch to the Administrator role.
9. Show a demand heatmap, predicted crowding, and a what-if simulation.
10. Clearly demonstrate that the app reduces missed classes, improves transport utilization, and protects student safety.

Add concise AI explanations throughout the app. For example:

- “This shared auto is recommended because it is verified, has 4 seats available, and reaches the college before 8:50 AM.”
- “Rampur has a high transport risk today because Bus B-102 is cancelled and 42 students depend on this route.”
- “Assigning Van V-03 reduces the number of stranded students from 42 to 9.”

Make the final result visually polished, functional end-to-end, and ready to present as an AI-powered rural mobility solution











###Surprise hurdle solution
## 10. Crisis Response Mode: Examination-Day Transport Emergency

Add a fully functional **Crisis Response Mode** for NXTPATH. This mode must activate during major rural transportation disruptions and intelligently update transport plans in real time.

### Crisis scenario

Create a preloaded surprise scenario called:

**“Examination-Day Flood Crisis”**

The scenario includes all of the following at once:

- Two government buses become unavailable because of technical breakdowns.
- Student transport demand increases by 40%.
- Flooding blocks the major road connecting Kheda and Sonapur.
- Multiple students have examinations beginning within the next two hours.
- Available buses, school vans, shared autos, and verified vehicles have limited capacity.

### Required crisis-response features

1. **Crisis activation**
   - Add a “Activate Examination-Day Flood Crisis” button on the School Coordinator and Transport Administrator dashboards.
   - When activated, mark two buses as broken down, close the flooded road, increase student demand by 40%, and create urgent examination deadlines.

2. **Exam-priority ranking**
   - Automatically rank students by urgency.
   - Students with an examination within two hours must receive highest priority.
   - Use a visible priority score based on examination start time, distance from institution, available transport options, accessibility needs, and current location.
   - Clearly label students as Critical, High, Medium, or Low priority.

3. **Smart vehicle reallocation**
   - Automatically identify available buses, school vans, shared autos, and verified community vehicles.
   - Reassign vehicles from low-demand routes to high-priority examination routes where possible.
   - Respect each vehicle’s capacity, route feasibility, travel time, and road closures.
   - Never exceed vehicle capacity.

4. **Alternative route planning**
   - Detect that the Kheda–Sonapur road is blocked.
   - Exclude blocked roads from all journey recommendations.
   - Suggest alternate pickup points, indirect roads, walking-to-safe-stop routes, pooled vehicles, and emergency school vans.
   - Show increased travel time and explain route changes clearly.

5. **Emergency commute pods**
   - Group students with nearby locations, similar destinations, and similar examination times.
   - Fill seats efficiently while prioritizing students with the earliest examination start times.
   - Show the assigned vehicle, pickup point, departure time, arrival estimate, and remaining seats.

6. **Live rescue dashboard**
   - Create a Crisis Command Center dashboard for the coordinator.
   - Display:
     - total students affected
     - students with examinations within two hours
     - stranded students
     - vehicles available
     - vehicles reassigned
     - seats available versus seats required
     - routes closed
     - students predicted to arrive late
     - students successfully rescued

7. **AI emergency recommendation**
   - Generate a clear, actionable plan such as:
     - “Reassign Bus B-205 from the Devgaon route to Government Degree College.”
     - “Deploy School Van V-03 to Rampur pickup point for 12 examination students.”
     - “Assign Verified Auto A-08 to transport 4 students from Kheda using the flood-safe alternate route.”
   - Explain the benefit of every recommendation in plain language.

8. **Manual coordinator control**
   - Allow the coordinator to approve, reject, or modify each AI recommendation.
   - When a vehicle is assigned, instantly update seat availability and affected student plans.
   - Prevent conflicting or duplicate vehicle assignments.

9. **Before-and-after impact comparison**
   - Show a visual comparison between:
     - the situation before AI intervention
     - the optimized transportation plan after intervention
   - Include metrics for students rescued, likely late arrivals, unused seats, vehicle utilization, and estimated missed examinations prevented.

### Crisis demo data

Create this emergency state automatically when the scenario is activated:

- Bus B-102: broken down, capacity 42, normally serves Rampur to Government Degree College.
- Bus B-205: broken down, capacity 38, normally serves Kheda to District Polytechnic.
- Kheda–Sonapur main road: closed because of flooding.
- 112 students affected by the disruption.
- 56 students have examinations starting within two hours.
- Demand across affected villages increases by 40%.
- 3 school vans with capacities of 12, 15, and 18.
- 8 verified shared autos with capacities between 3 and 6.
- 2 spare government buses that can be reassigned from lower-demand routes.
- Include enough alternate routes and vehicle capacity for the AI plan to rescue most, but not necessarily all, affected students.

### Crisis demo flow

During the hackathon demo, the presenter must be able to:

1. Open the Crisis Command Center.
2. Activate the Examination-Day Flood Crisis.
3. Show both bus breakdowns, the flooded road, and the 40% demand increase.
4. Show the AI identify examination students as the highest priority.
5. Show the AI create alternate routes and reallocate available vehicles.
6. Approve the proposed emergency transport plan.
7. Show students being assigned to commute pods and emergency vehicles.
8. Show the final impact dashboard, including the number of students expected to reach exams on time.

The system must make decisions immediately using the built-in transport optimization engine. It must work with seeded data, handle unavailable vehicles or full capacity gracefully, and show clear errors when no safe transportation option exists.
