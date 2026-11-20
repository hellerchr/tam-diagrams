// Example diagrams to start from, by the type they show: TAM block diagrams from the SAP TAM flyer, the TAM standard's
// figures and published reference architectures, and Mermaid UML (class, use case, activity with and without lanes,
// state, sequence, ER). Pure data, loaded with import() only when examples are asked for (the diagram chooser). Taken
// from tam-diagrams' corpus (src/samples), without the entries that only test the layout or the errors.

/** An example: its name and its source. */
export type Example = [name: string, source: string];

/** The examples by the kind of diagram they are: "tam", else detectUml's kind (a swimlane is an activity diagram, so
 *  it is under flowchart). */
export const EXAMPLES: Record<
  "tam" | "class" | "usecase" | "flowchart" | "state" | "sequence" | "er",
  Example[]
> = {
  tam: [
    [
      "SAP TAM flyer: web service landscape",
      `title SAP ERP web services
%% The conceptual-level example from the SAP TAM flyer.
level conceptual
human user[User] ...
agent consumer[Consuming Application] ...
agent sap[SAP ERP] {
  agent wse[Web Service Enabling]
  storage registry[Registered Services]
  agent business[Business Application] ...
  storage data[Business Data]
}
agent provider[Providing Application] stack
user --- consumer
consumer -- calls: Web Service Call --> wse
wse -- calls: Web Service Call --> provider
wse <-- calls --> business
wse -- reads --> registry
business -- reads/writes --> data
`,
    ],
    [
      "Web server, nested (TAM standard figure 2-1)",
      `level conceptual
agent browser[Web Browser]
agent server[Web Server] {
  agent http[HTTP Server]
  storage pages[Static HTML Pages]
  agent directory[Directory Agent]
  storage persistent[Persistent Data]
}
browser -- calls @HTTP --> http
http -- reads --> pages
http -- calls --> directory
directory -- reads/writes --> persistent
`,
    ],
    [
      "Protocols, data flow and dependencies",
      `title Order pipeline
direction LR
human clerk[Sales Clerk]
agent ui[Order Entry UI]:::blue
agent backend[Order Service] {
  agent api[REST API]
  agent worker[Fulfillment Worker] stack
  group {
    storage orders[Orders]
    storage audit[Audit Log]
  }
}
agent erp[ERP Connector]:::orange
agent factory[Worker Factory]
storage catalog[Product Catalog] {
  storage items[Items]
  storage prices[Price Lists]
}
clerk --- ui
ui -- calls: JSON @HTTPS --> api
api -- sends data: order events --> worker
worker -- calls: IDoc @RFC --> erp
api -- reads/writes --> orders
worker -- writes --> audit
api -- reads --> catalog
prices -. pointer .-> items
factory -. create .-> worker
`,
    ],
    [
      "Design level: components and interfaces",
      `title Checkout service (design level)
level design
agent shop[Web Shop] {
  component cart[Cart]
  component checkout[Checkout] {
    class pricing[PricingEngine]
    storage session[Session State]
  }
  subsystem payments[Payments]
}
component gateway[Payment Gateway]
storage ledger[Ledger]
cart -- requires ICheckout --> checkout
checkout -- requires IPayment --> payments
payments -- requires IAuthorize --> gateway
payments -- writes --> ledger
checkout -- delegates --> pricing
pricing -- reads/writes --> session
gateway provides IRefund
cart requires IRecommendations
`,
    ],
    [
      "Package dependencies",
      `title Package structure
direction LR
package app[Consuming Application] {
  package ui[UserInterface]
  package access[DataAccess]
}
package client[WebService Client]
package model[Domain Model] {
  class order[Order]
  class item[OrderItem]
}
ui -. use .-> access
access -. import .-> client
access -. import .-> model
`,
    ],
    [
      "repli harness",
      `title repli architecture
human user[Developer]
agent web[Web UI]
agent harness[repli] {
  agent coordinator[Coordinator]
  agent loop[Agent Loop] stack
  agent kernel[Python Kernel] stack
  storage control[Control DB]
  storage snapshots[Snapshots]
}
agent provider[Model Provider]
agent mcp[MCP Server] ...
storage project[Project Files]
user --- web
web -- calls: control protocol @JSON-RPC --> coordinator
coordinator -- reads/writes --> control
coordinator -- calls --> loop
loop -- calls: Messages API @HTTPS --> provider
loop -- calls: cells --> kernel
kernel -- reads/writes --> snapshots
kernel -- calls: tools @MCP --> mcp
kernel -- reads/writes --> project
`,
    ],
    [
      "Multi-region deployment: deep nesting",
      `title Multi-region deployment
direction BT
human ops[Operator]
agent region_a[Region A]:::green {
  agent cluster_a[Cluster] {
    agent ingress_a[Ingress]
    agent app_a[App Pod] ...
    storage cache_a[Local<br>Cache]
  }
  storage db_a[Primary DB] {
    storage tables_a[Tables]
    storage wal_a[WAL]
  }
}
agent region_b[Region B]:::purple {
  agent cluster_b[Cluster] {
    agent ingress_b[Ingress]
    agent app_b[App Pod] stack
  }
  storage db_b[Replica DB]
}
agent dns[Global DNS]
ops -- calls: deploy --> region_a
ops -- calls: deploy --> region_b
dns -- calls @HTTPS --> ingress_a
dns -- calls @HTTPS --> ingress_b
ingress_a -- calls --> app_a
ingress_b -- calls --> app_b
app_a -- reads/writes --> cache_a
app_a -- reads/writes --> tables_a
app_a -- writes --> wal_a
app_b -- reads --> db_b
region_a -- sends data: WAL shipping --> region_b
`,
    ],
    [
      "Parallel channels and chains",
      `title Parallel channels
agent client[Client]
agent gateway[API Gateway]
agent auth[Auth Service]
agent orders[Order Service]
agent billing[Billing]
client -- calls: REST @HTTPS --> gateway
gateway -- sends data: push events --> client
gateway -- calls: token check --> auth
auth -- calls: token check --> orders
gateway -- calls --> orders & billing
orders <-- calls: saga --> billing
`,
    ],
    [
      "Fan-in and fan-out accesses",
      `title Shared storages
agent ingest[Ingest]
agent enrich[Enrichment]
agent report[Reporting]
agent ml[Model Training]
agent admin[Admin Console]
storage raw[Raw Events]
storage curated[Curated Tables]
storage features[Feature Store]
storage config[Configuration]
ingest -- writes --> raw
enrich -- reads --> raw
enrich -- writes --> curated
report -- reads --> curated
ml -- reads --> curated
enrich -- reads/writes --> features
ml -- reads/writes --> features
admin -- reads/writes --> config
ingest -- reads --> config
enrich -- reads --> config
report -- reads --> config
ml -- reads --> config
`,
    ],
    [
      "Four levels of nesting",
      `title Nested landscape
agent corp[Corporate Network] {
  agent dc[Data Center] {
    agent rack[Rack 12] {
      agent vm[VM Host] {
        agent app[Application]
        storage tmp[Temp Files]
      }
      storage san[SAN Volume]
    }
    agent backup[Backup Agent]
  }
  agent office[Office] {
    human staff[Staff] ...
    agent pc[Workstation] stack
  }
}
agent cloud[Cloud Archive]
staff --- pc
pc -- calls: RDP --> app
app -- reads/writes --> tmp
app -- reads/writes --> san
backup -- reads --> san
backup -- calls: upload @S3 --> cloud
`,
    ],
    [
      "Multiples on both ends",
      `title Worker pool
agent dispatcher[Dispatcher]
agent worker[Worker] ...
storage queue[Queue] ...
storage results[Results]
human operator[Operator] stack
operator -- calls --> dispatcher
dispatcher -- writes --> queue
dispatcher -- sends data --> worker
worker -- reads/writes --> queue
worker -- writes --> results
dispatcher -- reads --> results
`,
    ],
    [
      "Containers as connection ends",
      `title Grouped access
direction LR
agent frontend[Frontend] {
  agent web[Web]
  agent mobile[Mobile API]
}
agent backend[Backend] {
  agent svc_a[Service A]
  agent svc_b[Service B]
}
group {
  storage db1[Customers]
  storage db2[Orders]
}
agent monitor[Monitoring]
frontend -- calls: calls --> backend
backend -- reads/writes --> db1
svc_b -- writes --> db2
monitor -- calls: probes --> frontend & backend
`,
    ],
    [
      "Design level interfaces at scale",
      `title Integration components
level design
subsystem integration[Integration Suite] {
  component router[Message Router]
  component mapper[Mapping Engine]
  storage store[Message Store]
}
component erp[ERP Adapter]
component crm[CRM Adapter]
component portal[Partner Portal]
class audit[AuditTrail]
portal -- requires IInbound --> router
router -- requires IMapping --> mapper
router -- requires IOrders --> erp
router -- requires ICustomers --> crm
router -- reads/writes --> store
mapper -. use .-> audit
erp provides IStatus
crm provides IStatus
portal requires IIdentity
router requires IMonitoring
`,
    ],
    [
      "Notes on agents and storages",
      `title Order handling
%% Notes remark on elements: one at the top level, one in a container, on dotted lines.
human clerk[Sales Clerk]
agent shop[Order Service] {
  agent api[Order API]
  agent worker[Worker] ...
  storage orders[Orders]
  note retention[Orders are kept<br>for ten years]
}
note peak[Up to 200 orders<br>a minute at peak]
note scaling[Scaled by load]
clerk -- calls --> api
api -- sends data --> worker
worker -- reads/writes --> orders
peak -.- api
retention -.- orders
worker -.- scaling
`,
    ],
    [
      "Hub with many labelled channels",
      `title Event hub
agent hub[Event Hub]
agent orders[Orders]
agent payments[Payments]
agent shipping[Shipping]
agent inventory[Inventory]
agent notify[Notifications]
agent analytics[Analytics]
agent audit[Audit]
storage log[Event Log]
orders -- sends data: OrderPlaced --> hub
payments -- sends data: PaymentCaptured --> hub
hub -- sends data: ShipmentRequested --> shipping
hub -- sends data: StockReserved --> inventory
hub -- sends data: CustomerNotified --> notify
hub -- sends data: all events --> analytics
hub -- calls: compliance export @SFTP --> audit
hub -- reads/writes --> log
`,
    ],
    [
      "Both-way requests and access labels",
      `title Peer replication
direction LR
agent node_a[Node A] {
  agent engine_a[Engine]
  storage data_a[Data]
}
agent node_b[Node B] {
  agent engine_b[Engine]
  storage data_b[Data]
}
agent coordinator[Coordinator]:::yellow
storage manifest[Cluster Manifest]
engine_a <-- calls: sync @gRPC --> engine_b
coordinator -- calls: elect leader --> engine_a & engine_b
engine_a -- reads/writes: append --> data_a
engine_b -- reads/writes: append --> data_b
coordinator -- reads: read config --> manifest
coordinator -- writes: publish epoch --> manifest
`,
    ],
    [
      "Dependencies and delegation across levels",
      `title Generated runtime
level design
subsystem runtime[Runtime] {
  component host[Host] {
    component loader[Loader]
    component plugin_a[Plugin A]
    component plugin_b[Plugin B]
  }
  storage repo[Metadata Repository] {
    storage schemas[Schemas]
    storage mappings[Mappings]
  }
}
component cli[Admin CLI]
loader -. generate .-> plugin_a
loader -. generate .-> plugin_b
mappings -. pointer .-> schemas
host -- delegates --> loader
loader -- reads --> repo
cli -- requires IAdmin --> host
host provides IHealth
plugin_b requires IExternal
`,
    ],
    [
      "Colors, stacks and groups",
      `title Styled elements
direction LR
human support[Support Agent]:::pink stack
agent desk[Service Desk]:::blue stack {
  agent triage[Triage]:::green
  agent escalation[Escalation]:::orange
}
group {
  agent bot[Chat Bot]:::purple
  agent kb[Knowledge Search]:::gray
}
storage tickets[Tickets]:::yellow stack
storage articles[Articles]:::red
support --- desk
triage -- calls --> bot & kb
kb -- reads --> articles
desk -- reads/writes --> tickets
escalation -- writes: reopen --> tickets
`,
    ],
    [
      "SAP landscape (large)",
      `title SAP landscape
human user[Business User] ...
human admin[Administrator]
agent fiori[Fiori Launchpad]
agent btp[SAP BTP] {
  agent cf[Cloud Foundry Apps] {
    agent ext[Side-by-side Extension] stack
    storage hana_cloud[HANA Cloud]
  }
  agent is[Integration Suite] {
    agent cpi[Cloud Integration]
    agent apim[API Management]
    storage sec[Security Material]
  }
  agent wz[Work Zone]
}
agent s4[S/4HANA] {
  agent gw[SAP Gateway]
  agent abap[ABAP Application Server] stack
  storage db[HANA Database] {
    storage master[Master Data]
    storage txn[Transactional Data]
  }
}
agent partner[Partner System] ...
agent idp[Identity Provider]
storage dms[Document Store]
user -- calls: launch @HTTPS --> fiori
admin -- calls @HTTPS --> wz
fiori -- calls: OData --> gw
wz -- calls --> ext
ext -- calls: REST --> apim
apim -- calls: OData --> gw
cpi -- calls: IDoc @RFC --> abap
partner -- calls: EDI @AS2 --> cpi
gw -- calls --> abap
abap -- reads/writes --> master
abap -- reads/writes --> txn
ext -- reads/writes --> hana_cloud
cpi -- reads --> sec
abap -- writes --> dms
fiori -- calls: SAML --> idp
wz -- calls: SAML --> idp
`,
    ],
    [
      "TAM standard figure 2-1",
      `title Web server (TAM standard, figure 2-1)
level conceptual
human user[] stack
agent browser[Web Browser] stack
agent server[Web Server]
storage pages[Static HTML Pages]
agent directory[Directory Agent]
storage data[Persistent Data]
user --- browser
browser -- calls @HTTP --> server
server -- reads --> pages
server -- calls --> directory
directory -- writes --> pages
directory -- reads/writes --> data
`,
    ],
    [
      "Online shop (SAP Community blog)",
      `title Online shop (SAP Community, TAM part 2)
agent customers[Customers] {
  human c1[]
  human c2[]
  ...
  human c3[]
}
agent shop[Online Shop Server] {
  agent account[customer account maintenance]
  agent presentation[product presentation + selection]
  agent processing[order processing]
  storage carts[shopping carts] {
    storage cart1[]
    storage cart2[]
    ...
    storage cart3[]
  }
}
agent provider[service provider] {
  agent cards[credit card institutions]
  agent shipping[shipping]
  agent suppliers[suppliers]
  ...
}
storage erp[ERP data] {
  storage customer_data[customer data]
  storage product_info[product information]
  group sales_data {
    storage availability[product availability]
    storage orders[orders]
  }
}
c1 -- calls: register<br>edit profile<br>browse orders --> account
c2 -- calls: search<br>get prod. info<br>select items --> presentation
c3 -- calls: place order<br>cancel order --> processing
processing -- calls --> provider
presentation -- reads/writes --> carts
processing -- reads --> carts
account -- reads/writes --> customer_data
processing -- reads/writes --> sales_data
account -- reads --> erp
`,
    ],
    [
      "Travel agency (FMC introduction)",
      `title Travel agency (FMC quick introduction)
human customers[Customers] stack
human person1[]
...
human person2[]
agent browser1[HTTP Browser]
agent browser2[HTTP Browser]
agent agency[Travel agency] {
  agent reservation[Reservation system]
  agent desk[Information help desk] {
    agent http[HTTP Server]
    agent builder[Document builder]
    storage cache[Document cache]
    storage templates[Templates]
    storage pubsub[Publish / subscribe channel]
    agent adapter1[Adapter]
    ...
    agent adapter2[Adapter]
    agent adapter3[Adapter]
  }
}
group bookings {
  storage reservations[Reservations]
  storage customer_data[Customer data]
}
group info[Travel information] {
  agent dbms[Database management system]
  storage docs1[documents]
  agent imap[IMAP Server]
  storage docs2[documents]
  agent web[HTTP Server]
  storage xml[XML documents]
}
agent organization[Travel organization] stack
customers -- calls: place order,<br>get ticket --> reservation
person1 --- browser1
person2 --- browser2
browser1 -- calls --> http
browser2 -- calls --> http
reservation -- calls --> http
http -- calls --> builder
builder -- reads/writes --> cache & templates
builder -- reads --> pubsub
adapter1 -- writes --> pubsub
adapter2 -- writes --> pubsub
adapter3 -- writes --> pubsub
adapter1 -- calls: SQL --> dbms
adapter2 -- calls: IMAP4 --> imap
adapter3 -- calls: HTTP --> web
dbms -- reads/writes --> docs1
imap -- reads/writes --> docs2
web -- reads --> xml
reservation -- reads/writes --> bookings
organization -- reads/writes --> bookings
organization -- calls --> dbms & imap
organization -- writes --> xml
`,
    ],
    [
      "TAM standard figure 2-2",
      `title Design level (TAM standard, figure 2-2)
level design
direction LR
human user[]
agent controller[Controller]
agent views[System Views] {
  agent nav[Navigation View]
  agent result[Search Result View]
  agent specify[Specify User View]
  agent modify[Modify View]
}
subsystem backend[Backend]:::blue {
  component users[User Manager]
  component access[Data Access Agent] {
    component data[Data Manager]
    component search[Search Engine]
    component meta[Metadata controller]
  }
  component navigation[Navigation Cache Manager]
  storage navcache[Navigation Cache]
  component searching[Search Cache Manager]
  storage searchcache[Search Cache]
  component personalization[Personalization Manager]
}
storage database[Database] {
  storage rights[User Rights]
  storage directory[Directory]
  storage pdata[Personalization Data] {
    storage mapping[User Mapping]
    storage xslt[XSLT Repository]
    ...
  }
}
user -- calls @HTTP --> controller & views
views -- calls --> controller
controller -- requires --> users
views -- requires --> search
modify -- requires --> meta
views -- requires --> personalization
users -- requires --> access
data -- requires --> search
data -- requires --> navigation
search -- requires --> searching
navigation -- reads/writes --> navcache
searching -- reads/writes --> searchcache
users -- reads/writes --> rights
navigation -- reads/writes --> directory
searching -- reads/writes --> directory
personalization -- reads/writes --> pdata
meta -- reads --> directory
`,
    ],
    [
      "Simple system (Apache Modeling Project)",
      `title Simple system (Apache Modeling Project, figure 2.1)
human u1[]
...
human u2[]
agent b1[Browser]
...
agent b2[Browser]
agent server[HTTP Server]
storage files[Files]
agent editor1[Editor]
agent editor2[Editor]
human a1[]
human a2[]
u1 --- b1
u2 --- b2
b1 -- calls: HTTP --> server
b2 -- calls: HTTP --> server
server -- reads --> files
editor1 -- reads/writes --> files
editor2 -- reads/writes --> files
a1 --- editor1
a2 --- editor2
`,
    ],
    [
      "Web service enabling layer (SAP Community blog)",
      `title Web service enabling layer (SAP Community, TAM part 1, figure 3)
agent consumer[Consuming application]
agent provider[Providing application]
agent server[SAP Application Server ABAP] {
  agent http_layer[HTTP Communication Layer] {
    agent http[HTTP Communication Framework]
    storage registered[Registered Web Services]
  }
  agent ws_layer[Web Service Enabling Layer] {
    agent interpreter[Web Service Interpreter<br>(WS runtime)]
    agent xi[XI Local Integration Engine]
    storage xi_log[XI Log]
    agent proxy_fw[Proxy Framework]
    storage meta[Service Meta data]
    agent proxies[Web Service Proxies] {
      agent p1[]
      agent p2[]
      agent p3[]
      ...
      agent p4[]
    }
  }
  agent logic[SAP Business Logic Layer] {
    agent apps[Applications] {
      agent app1[Application]
      agent app2[Application]
      ...
      agent app3[Application]
    }
    storage data[Business data]
  }
}
consumer -- calls: Enterprise<br>Service Calls @HTTP (incl. SOAP) Messages --> http
http -- calls: Web Service<br>Calls @HTTP (incl. SOAP) Messages --> provider
http -- calls: inbound @HTTP Messages --> interpreter
interpreter -- calls: outbound @HTTP Messages --> http
http -- reads --> registered
interpreter -- calls: Logging --> xi
xi -- reads/writes --> xi_log
interpreter -- calls: inbound @SOAP Messages (XML) --> proxy_fw
proxy_fw -- calls: outbound @SOAP Messages (XML) --> interpreter
proxy_fw -- reads --> meta
proxy_fw -- calls: inbound @Message Data (ABAP) --> proxies
proxies -- calls: outbound @Message Data (ABAP) --> proxy_fw
proxies -- calls: Local Calls:<br>BAPI, RFC, Fct. Mod. --> apps
apps -- calls: Outbound<br>Web Service Calls --> proxies
apps -- reads/writes --> data
`,
    ],
    [
      "Online shop (Wikipedia, FMC block diagram)",
      `title Online Shop
human user[ ]
agent shop[Online Shop] {
  agent op[Order Processor]
  agent sm[Supplier Manager]
  storage orders[Orders] {
    storage po[Purchase Order] stack
  }
  storage catalog[Product Catalog]
}
agent supplier[Supplier] stack
user -- calls --> op
op --- sm
op -- reads/writes --> orders
op -- reads --> catalog
sm -- reads/writes --> catalog
sm -- calls --> supplier
`,
    ],
    [
      "Web server with structure (FMC)",
      `title Web Server (compositional structure)
human user[User]
agent browser[Web Browser]
agent server[Web Server] {
  agent dispatcher[Request Dispatcher]
  agent handler[Request Handler]:::gray
}
agent dbserver[Database Server]
storage pages[Static Pages]
storage db[Database]
user --- browser
browser -- calls --> dispatcher
dispatcher -- calls --> handler
handler -- calls --> dbserver
handler -- reads --> pages
dbserver -- reads/writes --> db
`,
    ],
    [
      "Object agent view: a dispatcher (Tabeling, Gröne)",
      `title Object Agent View: A dispatcher
human user[ ]
agent gui[GUI I/O System]
group {
  agent dispatcher[Dispatcher]
  storage registry[Event Registry]
}
agent circle[Circle 1]:::gray {
  agent cm[Circle<br>Methods]
  storage cp[Circle<br>Properties]
}
agent rect[Rectangle 1]:::gray {
  agent rm[Rectangle<br>Methods]
  storage rp[Rectangle<br>Properties]
}
...
agent ok["OK"-Button]:::gray {
  agent bm[Button<br>Methods]
  storage bp[Button<br>Properties]
}
user -- screen,<br>mouse, keyboard --- gui
gui --- dispatcher
dispatcher -- reads/writes --> registry
dispatcher -- calls --> cm
dispatcher -- calls --> rm
dispatcher -- calls --> bm
cm -- reads/writes --> cp
rm -- reads/writes --> rp
bm -- reads/writes --> bp
`,
    ],
    [
      "Data record view (Tabeling, Gröne)",
      `title Data Record View
agent lockmgr[Lock Manager]
storage lockdata[Lock Data] {
  storage l1[ ]
  storage l2[ ]
  storage l3[ ]
}
group threads {
  agent t1[Thread<br>Agent 1]:::gray
  ...
  agent tn[Thread<br>Agent n]:::gray
}
storage tl1[Thread-local<br>Data]
...
storage tln[Thread-local<br>Data]
storage od[Object Data (shared)] {
  storage vec[Vector<br>Data] {
    storage x[x]
    storage y[y]
    storage z[z]
  }
  storage o2[ ] {
    storage o2a[ ]
    storage o2b[ ]
  }
  storage o3[ ] {
    storage o3a[ ]
    storage o3b[ ]
  }
  ...
  storage other[(other Object Data)]
}
agent pm[Persistency Manager]
storage osi[Object state<br>info]
storage mapping[Mapping<br>Information]
storage db[Database]
threads -- calls --> lockmgr
threads -- calls --> pm
lockmgr -- reads/writes --> lockdata
t1 -- reads/writes --> tl1
tn -- reads/writes --> tln
t1 -- reads/writes --> od
tn -- reads/writes --> od
pm -- reads/writes --> osi
pm -- reads --> mapping
pm -- reads/writes --> od
pm -- reads/writes --> db
`,
    ],
    [
      "Object agent view: persistency service (Tabeling, Gröne)",
      `title High-level Object Agent View: Persistency Service
agent po[Persistent Objects]:::gray {
  group o1 {
    agent oa1[ ]
    storage os1[ ]
  }
  ...
  group o2 {
    agent oa2[ ]
    storage os2[ ]
  }
}
agent ts[Transaction Service] {
  agent tm[Trans-<br>action<br>Manager]
  storage tt[Trans-<br>action<br>Tree]
}
agent ps[Persistency Service]:::gray {
  group {
    agent ca[class agent<br>for class A<br>(singl.)]
    storage osiA[object<br>state info]
    storage mapA[Mapping]
  }
  ...
  group {
    agent cx[class agent<br>for class X<br>(singl.)]
    storage osiX[object<br>state info]
    storage mapX[Mapping]
  }
  group {
    agent pm[Persistency Manager (singleton)]
    storage lca[list of class<br>agents]
  }
}
agent dbms[Database Mangement System]
storage db[Database]
oa1 -- reads/writes --> os1
oa2 -- reads/writes --> os2
ca -- reads/writes --> osiA
ca -- reads --> mapA
cx -- reads/writes --> osiX
cx -- reads --> mapX
tm -- reads/writes --> tt
pm -- reads/writes --> lca
o2 -- calls: start,<br>commit --> ts
po -- calls: create,<br>find --> ps
o1 <-- calls: create object,<br>set & read data --> ca
o2 <-- calls: create object,<br>set & read data --> cx
ts -- calls: save --> pm
pm --- ca
pm --- cx
pm -- calls --> dbms
dbms -- reads/writes --> db
`,
    ],
    [
      "Apache preforking MPM (Apache Modeling Project)",
      `title The Apache 2.0 Preforking MPM
human admin[ ]
storage gfiles[Files] {
  storage gconf[global<br>config.]
}
agent c1[Client]
...
agent c2[Client]
agent apache[Apache HTTP Server]:::gray {
  storage sockets[Sockets]
  agent tcp[TCP/IP Communication Service]
  agent master[Master Server]
  storage mconf[con-<br>fig.]
  group variance {
    group child1_set {
      agent child1[Child Server 1]
      storage conf1[con-<br>fig.]
    }
    ...
    group childn_set {
      agent childn[Child Server n]
      storage confn[con-<br>fig.]
    }
  }
  storage shm[shared memory] {
    storage scoreboard[Scoreboard] {
      storage gen[genera-<br>tion]
    }
    storage mutex[accept<br>mutex]
  }
}
storage files[Files] {
  storage docs[Documents]
  storage scripts[Scripts]
  storage htaccess[local<br>configuration<br>(.htaccess)]
}
c1 -- calls: HTTP --> tcp
c2 -- calls --> tcp
tcp -- reads/writes --> sockets
admin -- calls: Signals:<br>- stop (TERM)<br>- restart (HUP)<br>- grc.rst.(USR1) --> master
admin -- reads/writes --> gfiles
master -- reads --> gconf
master -- reads/writes --> mconf
master -- sends data: shutdown:<br>pipe of death<br>+ signals --> child1
master -- sends data --> childn
tcp --- child1
tcp --- childn
child1 -- reads --> conf1
childn -- reads --> confn
child1 -- reads --> files
childn -- reads --> files
master -- reads/writes --> shm
child1 -- reads/writes --> shm
childn -- reads/writes --> shm
`,
    ],
    [
      "CORBA system structure (POSA)",
      `title CORBA system structure
agent client[Client written<br>in Java] stack
agent stub[IDL Stub]
agent broker[Conceptual Broker] {
  storage ior1[Interoperable<br>Object<br>References]
  agent orb1[Local ORB<br>(JacORB)]
  agent oa1[Object<br>Adapter]
  agent orb2[Local ORB<br>(VisiBroker)]
  storage ior2[Interoperable<br>Object<br>References]
  agent oa2[Object<br>Adapter]
}
agent skel[Static IDL<br>Skeleton]
agent comp[Component<br>written in C++]
storage state[State]
client -- calls --> stub
stub -- calls --> orb1
orb1 -- reads/writes --> ior1
orb2 -- reads/writes --> ior2
orb1 -- @IIOP --- orb2
orb1 --- oa1
orb2 --- oa2
oa2 --- skel
skel -- sends data --> comp
comp -- calls --> oa2
comp -- sends data --> orb2
comp -- reads/writes --> state
`,
    ],
    [
      "Apache HTTP Server in its environment (Apache Modeling Project)",
      `title The Apache HTTP Server in its environment
human u1[ ]
human u2[ ]
...
human un[ ]
agent b1[Web Browser]
agent b2[Web Browser]
...
agent bn[Web Browser]
human admin[Admin]
agent proxyserver[HTTP Server]
agent authsrv[any Server<br>(e.g. auth.<br>service)]
agent machine[Server machine]:::gray {
  agent apache[Apache HTTP Server]
  storage files[Files] {
    storage docs[Documents]
    storage conf[Configuration]
    storage scripts[Scripts]
  }
  agent ipp[Information processor and provider]:::gray {
    agent progs[script programs<br>compiled programs]
    agent ext[Apache server<br>extensions]
  }
  agent dbsrv[any Server<br>(e.g. database)]
}
u1 --- b1
u2 --- b2
un --- bn
b1 -- calls: HTTP --> apache
b2 -- calls: HTTP --> apache
bn -- calls: HTTP --> apache
admin -- calls --> apache
admin -- reads/writes --> files
apache -- calls: CGI --> progs
apache -- calls: Server API --> ext
apache -- calls: HTTP<br>proxy --> proxyserver
ipp -- calls: any<br>protocol --> authsrv
ipp -- calls: any<br>protocol --> dbsrv
ipp -- reads/writes --> files
`,
    ],
  ],
  class: [
    [
      "Harness session",
      `classDiagram
  class Session {
    +id: str
    +project: Path
    +send(text)
  }
  class Kernel {
    +run(code)
    +interrupt()
  }
  class Agent {
    +definition: str
    +model: str
  }
  Session "1" --> "1" Kernel
  Session "1" --> "*" Agent
`,
    ],
  ],
  usecase: [
    [
      "Purchasing",
      `usecase-beta
  direction LR
  actor User
  actor Manager
  actor svc("Purchasing Service")
  systemBoundary shop[Purchasing]
    create(Create Order)
    approve(Approve Order)
    process(Process Order)
  end
  User --> create
  Manager --> approve
  create ..> : include approve
  svc --> process
`,
    ],
    [
      "SAP TAM flyer",
      `---
title: Ordering (TAM flyer)
---
usecase-beta
  direction LR
  actor User
  actor Manager
  actor svc("Purchasing Service") <<actor>>
  create(Create Order)
  approve(Approve Order)
  process(Process Order)
  User -- create
  Manager -- create
  Manager -- approve
  create --> approve
  approve --> process
  process -- svc
`,
    ],
    [
      "TAM standard figure 2-7",
      `usecase-beta
  direction LR
  %% level conceptual
  actor User
  actor Administrator
  actor Backend <<actor>>
  systemBoundary yeti["Yeti Intranet Directory"]
    editItem(Edit Item)
    selectItem(Select Item)
    editCategory(Edit Category)
    editLink(Edit Link)
    selectCategory(Select Category)
    selectLink(Select Link)
    deleteItem(Delete Item)
    deleteCategory(Delete Category)
    deleteLink(Delete Link)
    createItem(Create New Item)
    createCategory(Create New Category)
    createLink(Create New Link)
    activateItem(Activate Item)
    verifyLink(Verify Link)
  end
  User --> editItem
  User --> selectItem
  User --> createItem
  Administrator --> deleteItem
  Administrator --> activateItem
  editItem ..> : include selectItem
  editCategory --|> editItem
  editLink --|> editItem
  selectCategory --|> selectItem
  selectLink --|> selectItem
  deleteItem ..> : include selectItem
  deleteCategory --|> deleteItem
  deleteLink --|> deleteItem
  createItem ..> : include selectCategory
  createCategory --|> createItem
  createLink --|> createItem
  createItem ..> : include activateItem
  editItem ..> : include activateItem
  createLink ..> : include verifyLink
  editLink ..> : include verifyLink
  verifyLink -- Backend
`,
    ],
    [
      "Library TB with notes",
      `usecase-beta
  direction TB
  actor member("Library member")
  actor librarian("Librarian")
  systemBoundary lib[Library]
    borrow(Borrow book)
    returnBook(Return book)
    reserve(Reserve book)
    fine(Pay fine)
    search(Search catalog)
  end
  member --> borrow
  member --> returnBook
  member --> reserve
  librarian --> borrow
  borrow ..> : include search
  reserve ..> : include search
  fine ..> : extend returnBook
  note for fine "only when the book is late"
`,
    ],
    [
      "Actors and generalization",
      `usecase-beta
  actor Customer
  actor Guest
  actor Member
  actor Admin <<human>>
  Guest --|> Customer
  Member --|> Customer
  browse(Browse products)
  checkout(Check out)
  manage(Manage catalog)
  Customer --> browse
  Member -- pays --> checkout
  Admin --> manage
`,
    ],
    [
      "Two systems",
      `usecase-beta
  direction LR
  actor Patient
  actor Doctor
  actor lab("Lab system") <<system>>
  systemBoundary portal[Patient portal]
    book(Book appointment)
    results(View results)
  end
  systemBoundary clinic[Clinic system]
    treat(Treat patient)
    order(Order test)
  end
  Patient --> book
  Patient --> results
  Doctor --> treat
  Doctor --> order
  order --> lab
  lab --> results
`,
    ],
    [
      "Bank (large)",
      `usecase-beta
  direction LR
  actor Customer
  actor Teller
  actor Manager
  actor Auditor
  actor core("Core banking") <<system>>
  systemBoundary bank[Bank]
    open(Open account)
    close(Close account)
    deposit(Deposit money)
    withdraw(Withdraw money)
    transfer(Transfer funds)
    balance(Check balance)
    statement(Print statement)
    loan(Apply for loan)
    approveLoan(Approve loan)
    identify(Verify identity)
    audit(Review audit log)
    limits(Check limits)
  end
  Customer --> deposit
  Customer --> withdraw
  Customer --> transfer
  Customer --> balance
  Customer --> loan
  Teller --> open
  Teller --> close
  Teller --> statement
  Manager --> approveLoan
  Auditor --> audit
  open ..> : include identify
  close ..> : include identify
  withdraw ..> : include limits
  transfer ..> : include limits
  loan ..> : include identify
  statement ..> : extend balance
  deposit --> core
  withdraw --> core
  transfer --> core
`,
    ],
  ],
  flowchart: [
    [
      "Harness turn",
      `flowchart LR
  user([User prompt]) --> model[Model turn]
  model -->|python| kernel[(REPL kernel)]
  model -->|functions| discovery{{Function discovery}}
  discovery --> mcp[mcp.server tools]
  discovery --> agents[Agents and skills]
  kernel --> result[Tool result]
  mcp --> result
  agents --> result
  result --> model
  model --> reply([Final reply])
`,
    ],
    [
      "SAP TAM flyer activity without lanes",
      `---
title: Request processing (TAM flyer)
---
flowchart TB
  start((Start)) --> send(Send Request)
  send --> fork@{ shape: fork }
  fork --> doSomething(Do Something)
  fork --> merge{ }
  merge --> callLocal(Call Local Service)
  callLocal --> process(Process Request)
  process --> decision{ }
  decision -->|Done| reply(Send Response)
  decision -->|retry| merge
  doSomething --> wait(Wait for Response)
  wait --> join@{ shape: join }
  reply --> join
  join --> handle(Process Response)
  handle --> stop(((End)))
`,
    ],
    [
      "Node shapes",
      `flowchart LR
  a[Rectangle] --> b(Rounded action) --> c([Stadium]) --> d[[Subroutine]]
  d --> e[(Database)] --> f((Circle)) --> g{Decision?} --> h{{Hexagon}}
  h --> i[/Lean right/] --> j[\\Lean left\\] --> k[/Trapezoid\\] --> l[\\Inverted/]
  l --> m>Asymmetric] --> n(((Double)))
`,
    ],
    [
      "Edge kinds",
      `flowchart TB
  A --> B
  A --- C
  A -.-> D
  A ==> E
  A -- label text --> F
  A -. dotted label .-> G
  A == thick label ==> H
  B --o I
  C --x J
  D <--> K
  E o--o L
  F & G --> M & N
  H -->|pipe label| N
  I ~~~ J
`,
    ],
    [
      "Nested subgraphs LR",
      `flowchart LR
  subgraph cloud [Cloud]
    direction TB
    subgraph eu [EU region]
      api1[API] --> db1[(Primary DB)]
    end
    subgraph us [US region]
      api2[API] --> db2[(Replica DB)]
    end
    db1 -. replication .-> db2
  end
  client([Browser]) --> lb{{Load balancer}}
  lb --> api1
  lb --> api2
  ops[Operations] --> cloud
`,
    ],
    [
      "Login decisions",
      `flowchart TD
  start((Start)) --> form[Show login form]
  form --> submit(Submit credentials)
  submit --> valid{Credentials valid?}
  valid -->|yes| mfa{MFA enabled?}
  valid -->|no| attempts{More than 3 attempts?}
  attempts -->|no| form
  attempts -->|yes| lock[Lock account] --> notify[Notify owner] --> fail(((Rejected)))
  mfa -->|yes| code(Ask for code) --> check{Code correct?}
  check -->|no| code
  check -->|yes| session[Create session]
  mfa -->|no| session
  session --> done(((Logged in)))
`,
    ],
    [
      "CI pipeline (large)",
      `flowchart TB
  push([Push]) --> lint(Lint)
  push --> unit(Unit tests)
  push --> build(Build image)
  lint --> gate{All green?}
  unit --> gate
  build --> scan(Security scan)
  scan --> gate
  gate -->|no| report[Report failure] --> notify[Notify author]
  gate -->|yes| staging(Deploy to staging)
  staging --> smoke(Smoke tests)
  smoke --> e2e(End-to-end tests)
  smoke --> perf(Load tests)
  e2e --> approve{Release approved?}
  perf --> approve
  approve -->|no| hold[Hold release]
  approve -->|yes| canary(Canary 5%)
  canary --> metrics{Metrics healthy?}
  metrics -->|no| rollback(Roll back) --> notify
  metrics -->|yes| wide(Roll out 100%)
  wide --> tag[Tag release] --> changelog[Publish changelog]
  changelog --> done(((Done)))
  hold --> done
  notify --> done
`,
    ],
    [
      "SAP TAM flyer activity",
      `---
title: Request processing across agents (TAM flyer)
---
swimlane-beta TB
  subgraph Consumer
    start((Start)) --> send(Send Request) --> fork@{ shape: fork }
    fork --> doSomething(Do Something) --> wait(Wait for Response)
    join@{ shape: join } --> handle(Process Response) --> stop(((End)))
    wait --> join
  end
  subgraph wse [Web Service Enabling]
    merge{ } --> callLocal(Call Local Service)
    decision{ } -->|Done| reply(Send Response)
    decision -->|retry| merge
  end
  subgraph ba [Business Application]
    process(Process Request)
  end
  fork --> merge
  callLocal --> process
  process --> decision
  reply --> join
`,
    ],
    [
      "TAM standard figure 2-8",
      `swimlane-beta TB
  %% level conceptual
  subgraph User
    start((Start)) --> check{ } --> enter(Enter new Category Data) --> valid{ }
    valid -->|InputDataError| check
  end
  subgraph Updater
    fork1@{ shape: fork } --> create(Create Persistent Data of Category) --> newCat[New Category] --> join1@{ shape: join }
    fork1 --> update(Update Persistent Data of Parent Category) --> updCat[Updated Category] --> join1
    join1 --> persist(Persist Data) --> fork2@{ shape: fork }
    fork2 --> feedback(Progress Feedback Message) --> flowEnd@{ shape: cross-circ }
  end
  subgraph Renderer [Static Page Renderer]
    fork3@{ shape: fork } --> genPage(Generate Static Page of Category) --> join3@{ shape: join }
    fork3 --> updPage(Update Static Page of Parent Category) --> join3
    join3 --> persistPages(Persist Pages) --> stop(((End)))
  end
  valid --> fork1
  fork2 --> fork3
`,
    ],
    [
      "Request and response",
      `swimlane-beta TB
  subgraph Consumer
    start((Start)) --> send[Send Request] --> wait[Wait for Response] --> handle[Process Response] --> stop(((End)))
  end
  subgraph Provider
    process[Process Request] --> reply[Send Response]
  end
  send --> process
  reply --> handle
`,
    ],
    [
      "Order fulfilment LR",
      `swimlane-beta LR
  subgraph Customer
    order([Place order]) --> pay(Pay invoice)
    receive(Receive goods) --> done(((Done)))
  end
  subgraph Shop
    check{Stock available?} -->|yes| invoice(Send invoice)
    check -->|no| backorder(Order from supplier)
    paid(Confirm payment) --> ship(Ship goods)
  end
  subgraph Supplier
    deliver(Deliver stock)
  end
  order --> check
  backorder --> deliver --> invoice
  invoice --> pay --> paid
  ship --> receive
`,
    ],
    [
      "Incident handling (large)",
      `swimlane-beta TB
  subgraph Monitoring
    alert((Alert)) --> triage(Triage alert)
    triage --> severe{Severity high?}
  end
  subgraph OnCall [On-call engineer]
    ack(Acknowledge) --> investigate(Investigate)
    investigate --> known{Known issue?}
    known -->|yes| runbook(Apply runbook)
    known -->|no| escalate(Escalate)
    runbook --> verify(Verify recovery)
    verify --> fixed{Recovered?}
    fixed -->|no| investigate
  end
  subgraph Team [Service team]
    debug(Debug service) --> hotfix(Ship hotfix)
  end
  subgraph Comms [Communications]
    status(Post status page) --> update(Send updates)
    close(Close incident) --> postmortem[Postmortem report] --> stop(((End)))
  end
  severe -->|yes| ack
  severe -->|yes| status
  severe -->|no| ticket(Create ticket) --> stop2(((End)))
  escalate --> debug
  hotfix --> verify
  fixed -->|yes| close
  update --> close
`,
    ],
    [
      "TLS handshake: two lanes ping-pong",
      `swimlane-beta TB
  subgraph Client
    c1(Open connection) --> c2(Send hello)
    c3(Verify certificate) --> c4(Send key)
    c5(Send data) --> c6(((Closed)))
  end
  subgraph Server
    s1(Accept) --> s2(Send certificate)
    s3(Derive key) --> s4(Acknowledge)
  end
  c1 --> s1
  c2 --> s2
  s2 --> c3
  c4 --> s3
  s4 --> c5
`,
    ],
  ],
  state: [
    [
      "SAP TAM flyer",
      `---
title: Update task (TAM flyer)
---
stateDiagram-v2
  state "Updates Pending" as Pending
  state "Processing Update Task" as Processing
  state "Rolled Back" as RolledBack
  state "Commited" as Commited
  [*] --> Initial
  Initial --> Initial
  Initial --> Pending : Call Function in Update Task
  Pending --> Pending
  Pending --> Processing : Commit Work
  Pending --> RolledBack : Rollback Work / Release Locks
  Processing --> Aborted : Failure / Release Locks
  Processing --> Commited : Success / Release Locks
  RolledBack --> [*]
  Aborted --> [*]
  Commited --> [*]
`,
    ],
    [
      "TAM standard figure 2-11",
      `stateDiagram-v2
  %% level conceptual
  state "Display Search Results" as Results
  state "Display Category Mode" as Category
  state "Edit Mode" as Edit {
    [*] --> Unsaved
    Unsaved --> Saved : apply
    Saved --> Unsaved : change
    Saved --> [*]
  }
  [*] --> Category
  Category --> Results : search
  Results --> Category : navigate(url) [isCategory(url)]
  Results --> [*] : navigate(url) [isLink(url)]
  Category --> Category : navigate(url) [isCategory(url)] / browse to URL
  Category --> [*] : navigate(url) [isLink(url)]
  Category --> Edit : change category
  Edit --> Category : exit
`,
    ],
    [
      "Harness turn",
      `stateDiagram-v2
  [*] --> Idle
  Idle --> Running: prompt
  Running --> Waiting: question
  Waiting --> Running: answer
  Running --> Idle: done
  Running --> Idle: Esc
`,
    ],
    [
      "Composite and nested (Mermaid docs)",
      `stateDiagram-v2
  [*] --> First
  state First {
    [*] --> Second
    state Second {
      [*] --> second
      second --> Third
      state Third {
        [*] --> third
        third --> [*]
      }
    }
  }
  First --> Done
  Done --> [*]
`,
    ],
    [
      "Choice, fork and join",
      `stateDiagram-v2
  state if_state <<choice>>
  [*] --> IsPositive
  IsPositive --> if_state
  if_state --> False: if n < 0
  if_state --> True : if n >= 0
  state fork_state <<fork>>
  True --> fork_state
  fork_state --> State2
  fork_state --> State3
  state join_state <<join>>
  State2 --> join_state
  State3 --> join_state
  join_state --> State4
  State4 --> [*]
  False --> [*]
`,
    ],
    [
      "Concurrency (Mermaid docs)",
      `stateDiagram-v2
  [*] --> Active
  state Active {
    [*] --> NumLockOff
    NumLockOff --> NumLockOn : EvNumLockPressed
    NumLockOn --> NumLockOff : EvNumLockPressed
    --
    [*] --> CapsLockOff
    CapsLockOff --> CapsLockOn : EvCapsLockPressed
    CapsLockOn --> CapsLockOff : EvCapsLockPressed
    --
    [*] --> ScrollLockOff
    ScrollLockOff --> ScrollLockOn : EvScrollLockPressed
    ScrollLockOn --> ScrollLockOff : EvScrollLockPressed
  }
`,
    ],
    [
      "Notes and descriptions LR",
      `stateDiagram-v2
  direction LR
  state "Waiting for payment" as Waiting
  Waiting : entry / start timer
  Waiting : exit / stop timer
  [*] --> Waiting
  Waiting --> Paid : payment received [amount ok]
  Waiting --> Cancelled : after(15 min)
  Paid --> Shipped : ship / notify customer
  Shipped --> [*]
  Cancelled --> [*]
  note right of Waiting : The customer has 15 minutes<br>to complete the payment.
  note left of Shipped
    Tracking number is
    sent by e-mail.
  end note
`,
    ],
    [
      "Order lifecycle (large)",
      `stateDiagram-v2
  [*] --> Draft
  Draft --> Submitted : submit
  Draft --> Discarded : discard
  Submitted --> UnderReview : assign reviewer
  UnderReview --> Approved : approve
  UnderReview --> Rejected : reject
  UnderReview --> Draft : request changes
  Approved --> Scheduled : schedule
  state Fulfilment {
    [*] --> Picking
    Picking --> Packing : picked
    Packing --> ReadyToShip : packed
    ReadyToShip --> InTransit : carrier pickup
    InTransit --> Delivered : delivered
    InTransit --> Lost : lost in transit
    Delivered --> [*]
  }
  Scheduled --> Fulfilment : start
  Fulfilment --> Closed : complete
  Lost --> Refunded : refund
  Rejected --> Closed : archive
  Refunded --> Closed : archive
  Discarded --> [*]
  Closed --> [*]
`,
    ],
    [
      "Transitions across composites",
      `stateDiagram-v2
  direction LR
  state Connection {
    [*] --> Connecting
    Connecting --> Connected : handshake ok
    Connected --> Reconnecting : link lost
    Reconnecting --> Connected : link back
  }
  state Session {
    [*] --> Authenticating
    Authenticating --> Ready : token valid
  }
  [*] --> Connection
  Connected --> Session : open
  Reconnecting --> Failed : retries exhausted
  Session --> Closed : logout
  Failed --> [*]
  Closed --> [*]
`,
    ],
  ],
  sequence: [
    [
      "Harness turn",
      `sequenceDiagram
  participant W as Web UI
  participant B as Bridge
  participant H as Harness
  W->>B: send_message
  B->>H: start turn
  H-->>B: streamed text
  B-->>W: events
  H->>H: run python cell
  H-->>B: turn complete
  B-->>W: done
`,
    ],
    [
      "SAP TAM flyer",
      `---
title: Stock updates (TAM flyer)
---
sequenceDiagram
  participant A as Consumer A
  participant B as Consumer B
  participant S as Service Provider
  activate A
  activate B
  A->>+S: Change stock count by +200
  S-->>-A: Confirmation
  B->>+S: Change stock count by +100
  S-->>-B: Confirmation
  deactivate B
  deactivate A
`,
    ],
    [
      "TAM standard figure 2-9 (conceptual)",
      `sequenceDiagram
  %% level conceptual
  actor User
  participant Browser as Web Browser
  participant Server as Web Server
  activate User
  User->>+Browser: Click Link 'Add Link'
  Browser->>+Server: Request Page
  deactivate Server
  Browser->>+Server: Request Images
  deactivate Server
  deactivate Browser
  User->>+Browser: Insert Data
  deactivate Browser
  User->>+Browser: Click 'Submit'
  Browser->>+Server: Transmit Form Data<br>(HTTP POST)
  deactivate Server
  deactivate Browser
  deactivate User
`,
    ],
    [
      "TAM standard figure 2-10 (design)",
      `sequenceDiagram
  %% level design
  participant web as webServer:<br>HTTPworkProcess
  participant dyn as dynRenderer:<br>DynamicPageRenderer
  participant data as dataMgr:<br>DataAccessManager
  participant stat as statRenderer:<br>StaticPageRenderer
  activate web
  web->>+dyn: requestEditPage()
  dyn->>+data: getData()
  data-->>-dyn: Data
  create participant link as newLink:<br>LinkData
  dyn-)link: create
  dyn-->>-web: Edit Page
  alt Cancel OR Timeout
    web->>web: discard
  else else
    web->>+dyn: addNewLink()
    dyn->>+link: insertLinkData(data)
    link-->>-dyn: OK code
    dyn->>+data: persistLinkData(newLink)
    data->>+link: getData()
    link-->>-data: Data
    data->>+stat: updateCurrentPage()
    stat-->>-data: OK code
    data-)stat: updateStaticPages()
    data-->>-dyn: done
    dyn-->>-web: Updated Page
  end
  destroy link
  web-xlink: delete
  deactivate web
`,
    ],
    [
      "Fragments (Mermaid docs)",
      `sequenceDiagram
  autonumber
  Alice->>John: Hello John, how are you?
  loop Every minute
    John-->>Alice: Great!
  end
  alt is sick
    Bob->>Alice: Not so good :(
  else is well
    Bob->>Alice: Feeling fresh like a daisy
  end
  opt Extra response
    Bob->>Alice: Thanks for asking
  end
  par Alice to Bob
    Alice->>Bob: Hello guys!
  and Alice to John
    Alice->>John: Hello guys!
  end
  critical Establish a connection to the DB
    Service-->DB: connect
  option Network timeout
    Service-->Service: Log error
  end
  break when the booking process fails
    Service-->Consumer: show failure
  end
  rect rgb(191, 223, 255)
    Alice->>+John: Is it ok?
    John-->>-Alice: Yes
  end
`,
    ],
    [
      "Arrows, notes and self messages",
      `sequenceDiagram
  participant A as Alice
  actor B as Bob
  participant C as Carol
  A->B: solid line
  A-->B: dotted line
  A->>B: synchronous call
  B-->>A: return
  A-xC: lost message
  A--xC: dotted lost
  A-)C: async message
  C--)A: async reply
  A<<->>C: both ways
  B->>B: think it over
  note right of C: Carol keeps a log
  note left of A: Alice starts
  note over A,B: Alice and Bob agree<br>on the protocol
  note over C: alone
`,
    ],
    [
      "Groups with boxes",
      `sequenceDiagram
  box Purple Frontend
    participant UI
    participant Store
  end
  box Backend services
    participant API
    participant DB
  end
  UI->>Store: dispatch(save)
  Store->>+API: POST /orders
  API->>+DB: INSERT order
  DB-->>-API: id
  API-->>-Store: 201 Created
  Store-->>UI: state updated
`,
    ],
    [
      "Checkout (large)",
      `sequenceDiagram
  actor U as Customer
  participant W as Web shop
  participant C as Cart service
  participant P as Pricing
  participant I as Inventory
  participant Pay as Payment gateway
  participant O as Order service
  participant M as Mailer
  U->>W: open cart
  W->>+C: load cart
  C->>+P: price items
  P-->>-C: prices
  C-->>-W: cart
  U->>W: checkout
  W->>+I: reserve items
  alt all items in stock
    I-->>W: reserved
    W->>+Pay: charge card
    Pay-->>-W: authorized
    W->>+O: create order
    O->>O: assign number
    O-)M: send confirmation
    O-->>-W: order id
    W-->>U: thank you page
  else something missing
    I-->>W: missing items
    W-->>U: adjust cart
  end
  deactivate I
  loop until shipped
    O->>I: poll status
  end
  M-)U: confirmation e-mail
`,
    ],
  ],
  er: [
    [
      "Order example (Mermaid docs)",
      `---
title: Order example
---
erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE-ITEM : contains
  CUSTOMER }|..|{ DELIVERY-ADDRESS : uses
  CUSTOMER {
    string name
    string custNumber
    string sector
  }
  ORDER {
    int orderNumber
    string deliveryAddress
  }
  LINE-ITEM {
    string productCode
    int quantity
    float pricePerUnit
  }
`,
    ],
    [
      "Every cardinality",
      `erDiagram
  direction LR
  PERSON ||--|| PASSPORT : holds
  PERSON |o--o| PARKING-SPACE : rents
  TEAM }|--|{ PLAYER : fields
  STUDENT }o--o{ COURSE : attends
  COUNTRY ||..o{ CITY : "has, apart from the capital"
  CITY }|..o| MAYOR : elects
  PASSPORT only one to zero or more VISA : carries
  PLAYER one or more optionally to zero or one SPONSOR : "is paid by"
  COURSE 1+ to many(0) LECTURE : "consists of"
`,
    ],
    [
      "Self-relationship and parallel relationships",
      `erDiagram
  EMPLOYEE |o--o{ EMPLOYEE : manages
  EMPLOYEE }o--|| DEPARTMENT : "works in"
  EMPLOYEE |o..o| DEPARTMENT : heads
  EMPLOYEE {
    int id PK
    string name
    int managerId FK
    int departmentId FK
  }
  DEPARTMENT {
    int id PK
    string name UK
    int headId FK
  }
  FLIGHT }o--|| AIRPORT : "departs from"
  FLIGHT }o--|| AIRPORT : "arrives at"
  FLIGHT {
    string number PK
    string origin FK
    string destination FK
    datetime departure
  }
  AIRPORT {
    string code PK
    string city
  }
`,
    ],
    [
      "Aliases, keys and comments",
      `erDiagram
  %% Names in the picture are the aliases; relationships use the short ids.
  p["Person"] {
    uuid id PK "generated"
    string firstName
    string lastName
    string email UK "one account per address"
    date born "may be unknown"
  }
  a["Postal address"] {
    uuid id PK
    uuid personId FK "the person living there"
    string street
    string city
    string postalCode
  }
  m["Membership"] {
    uuid personId PK, FK
    uuid clubId PK, FK
    date since
  }
  "Sports club" {
    uuid id PK
    string name UK
    varchar(2) country "ISO 3166-1"
    string[] colours
  }
  p ||--o{ a : "lives at"
  p ||--o{ m : has
  "Sports club" ||--o{ m : "is joined by"
`,
    ],
    [
      "Library BT with non-identifying relationships",
      `erDiagram
  direction BT
  BOOK }|..|{ AUTHOR : "written by"
  BOOK }o..|| PUBLISHER : "published by"
  COPY }|--|| BOOK : "is a copy of"
  LOAN }o--|| COPY : lends
  LOAN }o--|| MEMBER : "taken out by"
  BOOK {
    string isbn PK
    string title
    int year
  }
  COPY {
    int id PK
    string isbn FK
    string shelf
  }
  LOAN {
    int id PK
    int copyId FK
    int memberId FK
    date due
  }
  MEMBER {
    int id PK
    string name
  }
`,
    ],
    [
      "Order management (large)",
      `---
title: Order management
---
erDiagram
  CUSTOMER ||--o{ ORDER : places
  CUSTOMER ||--|{ ADDRESS : "is reached at"
  ORDER }o--|| ADDRESS : "ships to"
  ORDER ||--|{ ORDER-ITEM : contains
  PRODUCT ||--o{ ORDER-ITEM : "is ordered as"
  CATEGORY ||--o{ PRODUCT : groups
  CATEGORY |o--o{ CATEGORY : "is parent of"
  SUPPLIER ||--o{ PRODUCT : supplies
  ORDER ||--o{ PAYMENT : "is paid by"
  ORDER ||--o{ SHIPMENT : "is sent as"
  SHIPMENT }o..|| CARRIER : "is carried by"
  ORDER ||--o| INVOICE : "is billed by"
  CUSTOMER {
    int id PK
    string name
    string email UK
    date registered
  }
  ADDRESS {
    int id PK
    int customerId FK
    string street
    string city
    string postalCode
    string country
  }
  ORDER {
    int id PK
    int customerId FK
    int shipToId FK
    datetime placed
    string status "open, paid, shipped, closed"
  }
  ORDER-ITEM {
    int orderId PK, FK
    int position PK
    int productId FK
    int quantity
    decimal unitPrice
  }
  PRODUCT {
    int id PK
    string sku UK
    string name
    int categoryId FK
    int supplierId FK
    decimal price
  }
  CATEGORY {
    int id PK
    string name
    int parentId FK "empty for a root"
  }
  SUPPLIER {
    int id PK
    string name
    string phone
  }
  PAYMENT {
    int id PK
    int orderId FK
    decimal amount
    string method
    datetime paid
  }
  SHIPMENT {
    int id PK
    int orderId FK
    int carrierId FK
    string trackingNumber UK
    date shipped
  }
  CARRIER {
    int id PK
    string name
  }
  INVOICE {
    int id PK
    int orderId FK, UK
    date issued
    decimal total
  }
`,
    ],
  ],
};
