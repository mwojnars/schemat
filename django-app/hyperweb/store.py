"""
DATA STORE -- an abstract DB storage layer for items. Handles sharding, replication etc.
"""

from django.db import connection as db
from .errors import ItemDoesNotExist

class SQL:
    
    _item_columns       = 'cid iid data created updated'.split()
    _item_select_cols   = ','.join(_item_columns)
    _item_select        = f"SELECT {_item_select_cols} FROM hyper_items "
    _item_select_by_id  = _item_select + "WHERE cid = %s AND iid = %s"
    

#####################################################################################################################################################
#####
#####  DATA STORE
#####

class DataStore:
    """"""
    
class SimpleStore(DataStore):
    """Data store that uses only local DB, no sharding."""

    def _make_record(self, row, query_args = None):
        
        if row is None:
            raise ItemDoesNotExist(*((query_args,) if query_args is not None else ()))
        
        return {f'__{key}__': val for key, val in zip(SQL._item_columns, row)}

    def load(self, cid, iid):
        """Load from DB an item with a given ID = (CID,IID) and return as a record (dict)."""
        
        id = (cid, iid)
        
        # select row from DB and convert to record (dict with field names)
        with db.cursor() as cur:
            cur.execute(SQL._item_select_by_id, id)
            row = cur.fetchone()
            return self._make_record(row, query_args = id)

    def load_all(self, cid, limit = None):
        """
        Load from DB all items of a given category (CID) ordered by IID, possibly with a limit.
        Items are returned as an iterable of records (dicts).
        """
        query = SQL._item_select + f"WHERE cid = {cid} ORDER BY iid"
        if limit is not None:
            query += f" LIMIT {limit}"
            
        with db.cursor() as cur:
            cur.execute(query)
            return map(self._make_record, cur.fetchall())
        
    
    def insert(self, item):
        """
        Insert `item` as a new row in DB. Assign a new IID (self.__iid__) and return it.
        The item might have already been present in DB, but still a new copy is created.
        """
        query = f"INSERT INTO hyper_items(cid, iid, data) SELECT ()"
    
        # here, it is possible to split SELECT from INSERT, but then SELECT ... FOR UPDATE must be used,
        # so as to create a stronger lock on the DB rows involved and enable correct concurrent INSERTs
    
        with db.cursor() as cur:
            cur.execute(query, args)
            row = cur.fetchone()

    def update(self, item):
        """Update the contents of the item's row in DB."""
