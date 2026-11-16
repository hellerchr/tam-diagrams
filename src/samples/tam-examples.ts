/** TAM block diagrams that exercise the whole notation; used by tests and the lab page. */
export const TAM_EXAMPLES: [string, string][] = [
  [
    "flyer: web service landscape",
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
business -- reads/writes --> data`,
  ],

  [
    "standard figure 2-1: web server",
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
directory -- reads/writes --> persistent`,
  ],

  [
    "protocols, data flow and dependencies",
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
factory -. create .-> worker`,
  ],

  [
    "design level: components and interfaces",
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
cart requires IRecommendations`,
  ],

  [
    "package dependencies",
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
access -. import .-> model`,
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
kernel -- reads/writes --> project`,
  ],

  [
    "stress: deep nesting across containers",
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
region_a -- sends data: WAL shipping --> region_b`,
  ],

  [
    "variant: parallel channels and chains",
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
orders <-- calls: saga --> billing`,
  ],

  [
    "variant: fan-in and fan-out accesses",
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
ml -- reads --> config`,
  ],

  [
    "variant: RL with long and unicode labels",
    `title Lieferkette – Übersicht
direction RL
human kunde[Kunde mit einem ziemlich langen Namen, der umbrechen muss]
agent shop[Online-Shop „Straße“]
agent lager[Lager & Logistik <Nord>]
storage bestand[Bestand<br>(Echtzeit)]
agent zahlung[支付网关]
kunde -- calls: Bestellung aufgeben @HTTPS --> shop
shop -- calls: Zahlung autorisieren @HTTPS --> zahlung
shop -- sends data: Kommissionierauftrag --> lager
lager -- reads/writes --> bestand`,
  ],

  [
    "variant: four levels of nesting",
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
backup -- calls: upload @S3 --> cloud`,
  ],

  [
    "variant: multiples on both ends",
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
dispatcher -- reads --> results`,
  ],

  [
    "variant: containers as connection ends",
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
monitor -- calls: probes --> frontend & backend`,
  ],

  [
    "variant: design level interfaces at scale",
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
router requires IMonitoring`,
  ],

  [
    "variant: notes on agents and storages",
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
worker -.- scaling`,
  ],

  [
    "variant: BT single chain",
    `direction BT
human user[User]
agent ui[UI]
agent api[API]
storage db[Database]
user --- ui
ui -- calls --> api
api -- reads/writes --> db`,
  ],

  ["variant: minimal", `agent alone[Single Agent]`],

  [
    "challenge: hub with many labelled channels",
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
hub -- reads/writes --> log`,
  ],

  [
    "challenge: LR both-way requests and access labels",
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
coordinator -- writes: publish epoch --> manifest`,
  ],

  [
    "challenge: dependencies and delegation across levels",
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
plugin_b requires IExternal`,
  ],

  [
    "challenge: colors, stacks and groups everywhere",
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
escalation -- writes: reopen --> tickets`,
  ],

  [
    "challenge: large landscape",
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
wz -- calls: SAML --> idp`,
  ],

  [
    "reference: TAM standard figure 2-1",
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
directory -- reads/writes --> data`,
  ],

  [
    "reference: SAP blog online shop",
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
account -- reads --> erp`,
  ],

  [
    "reference: FMC travel agency",
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
organization -- writes --> xml`,
  ],

  [
    "reference: TAM standard figure 2-2",
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
meta -- reads --> directory`,
  ],

  [
    "reference: Apache simple system",
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
a2 --- editor2`,
  ],

  [
    "reference: SAP blog web service enabling layer",
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
apps -- reads/writes --> data`,
  ],

  [
    "reference: Wikipedia FMC block diagram: Online Shop",
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
sm -- calls --> supplier`,
  ],

  [
    "reference: FMC architecture-centric development: Web Server with struct",
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
dbserver -- reads/writes --> db`,
  ],

  [
    "reference: Tabeling/Groene: Object Agent View, a dispatcher",
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
bm -- reads/writes --> bp`,
  ],

  [
    "reference: Tabeling/Groene: Data Record View",
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
pm -- reads/writes --> db`,
  ],

  [
    "reference: Tabeling/Groene: High-level Object Agent View, Persistency S",
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
dbms -- reads/writes --> db`,
  ],

  [
    "reference: Apache Modeling Project, Fig 4.6: Preforking MPM",
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
childn -- reads/writes --> shm`,
  ],

  [
    "reference: POSA / CORBA system structure",
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
comp -- reads/writes --> state`,
  ],

  [
    "reference: Apache Modeling Project, Fig 3.1: Apache HTTP Server in its ",
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
ipp -- reads/writes --> files`,
  ],

  [
    "error: storage containing an agent",
    `storage db[Database] {
  agent cache[Cache]
}`,
  ],

  [
    "error: channel to a storage",
    `agent api[API]
storage db[Database]
api -- calls --> db`,
  ],
];
