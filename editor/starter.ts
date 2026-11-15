/** The diagram a first visit starts with. */
export const STARTER = `title Order system
human customer[Customer] @40,60
agent shop[Web Shop] @220,30 380x260 {
  agent api[Order API] @250,90
  agent worker[Fulfillment] @450,90
  storage cart[Cart] @250,220
  storage orders[Orders] @450,220
}
agent erp[ERP System]:::orange @700,90
customer -- calls: place order @HTTPS --> api
api -- sends data: order events --> worker
api -- reads/writes --> cart
api -- writes --> orders
worker -- reads --> orders
worker -- calls: IDoc @RFC --> erp
`;
