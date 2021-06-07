"""
DATA STORE -- an abstract DB storage layer for items. Handles sharding, replication etc.
"""

import csv, json, yaml
from pymysql.cursors import DictCursor
#from django.db import connection as db
from nifty.db import MySQL

from main.settings import DATABASES

from .errors import ItemDoesNotExist


#####################################################################################################################################################
#####
#####  GLOBAL
#####

default_db = None

# _settings = DATABASES['default']
#
# # local database for startup
# default_db = MySQL(host         = _settings.get('HOST'),
#                    port         = _settings.get('PORT'),
#                    user         = _settings.get('USER'),
#                    password     = _settings.get('PASSWORD'),
#                    db           = _settings.get('NAME'),
#                    )

#####################################################################################################################################################
#####
#####  DATA STORE
#####

class DataStore:
    """"""
    
class SimpleStore(DataStore):
    """Data store that uses only local DB, no sharding."""

    _item_columns       = 'cid iid data created updated'.split()
    _item_select_cols   = ','.join(_item_columns)
    _item_select        = f"SELECT {_item_select_cols} FROM hyper_items "
    _item_select_by_id  = _item_select + "WHERE cid = %s AND iid = %s"
    
    db = default_db

    def _make_record(self, row, query_args = None):
        
        if row is None:
            raise ItemDoesNotExist(*((query_args,) if query_args is not None else ()))
        
        return dict(zip(self._item_columns, row))
        # return {f'__{key}__': val for key, val in zip(self._item_columns, row)}

    def select(self, id_):
        """Load from DB an item with a given ID = (CID,IID) and return as a record (dict)."""
        
        # select row from DB and convert to record (dict with field names)
        with self.db.cursor() as cur:
            cur.execute(self._item_select_by_id, id_)
            row = cur.fetchone()
            return self._make_record(row, id_)

    def select_all(self, cid):
        """
        Load from DB all items of a given category (CID) ordered by IID, possibly with a limit.
        Items are returned as an iterable of records (dicts).
        """
        query = self._item_select + f"WHERE cid = {cid} ORDER BY iid"
        # if limit is not None:
        #     query += f" LIMIT {limit}"
            
        with self.db.cursor() as cur:
            cur.execute(query)
            return map(self._make_record, cur.fetchall())
        
    def insert(self, item):
        """
        Insert `item` as a new row in DB. Assign a new IID and return it.
        The item might have already been present in DB, but still a new copy is created.
        """
        cid = item.cid
        
        max_iid = self.db.select_one(f"SELECT MAX(iid) FROM hyper_items WHERE cid = {cid} FOR UPDATE")[0]
        if max_iid is None:
            max_iid = 0
        
        iid = max_iid + 1
        item.iid = iid
        
        # item.__encode__()
        assert item.data is not None
        # print("store:", list(item.data.lists()))
        
        record = {'cid':   cid,
                  'iid':   iid,
                  'data':  item._to_json(),
                  }
        self.db.insert_dict('hyper_items', record)
        
        # # get imputed fields from DB
        # (item.created, item.updated) = self.db.select_one(f"SELECT created, updated FROM hyper_items WHERE cid = {cid} AND iid = {iid}")
        
        self.db.commit()
        return iid
        
        # # here, it is possible to split SELECT out from INSERT, but then SELECT ... FOR UPDATE must be used,
        # # so as to create a stronger lock on the DB rows involved and enable correct concurrent INSERTs
        # query = f"""
        #     INSERT INTO hyper_items(cid, iid, data)
        #     SELECT {cid}, IFNULL(MAX(iid), 0) + 1, {data}
        #       FROM hyper_items WHERE cid = {cid}
        # """

    def update(self, item):
        """Update the contents of the item's row in DB."""


#####################################################################################################################################################

class FileStore(SimpleStore):
    """Items stored in a file. For use during development only."""

    filename = None
    items    = None         # dict of {item_id: json_data}, keys are tuples (cid,iid), values are strings
    
    def select(self, id_):
        
        data = self.items[id_]
        row = id_ + (data, None, None)
        return self._make_record(row, id_)

    def select_all(self, cid):
        
        for row in self.items.items():
            (cid_, iid_), data = row
            if cid != cid_: continue
            yield self._make_record((cid_, iid_, data, None, None))
        
    def insert(self, item):
        raise NotImplementedError
    
    
class CsvStore(FileStore):
    
    def __init__(self, filename = None):
        self.filename = filename or DATABASES['csv']['FILE']
        
        with open(self.filename, newline = '') as f:
            reader = csv.reader(f, delimiter = ';', quotechar = '"')
            self.items = {(int(cid), int(iid)): data for cid, iid, data in list(reader)}
            
            print('CsvStore items loaded:')
            for id, data in self.items.items():
                print(id, data)
    
class JsonStore(FileStore):
    """Items stored in a JSON file. For use during development only."""
    
    def __init__(self, filename = None):
        self.filename = filename or DATABASES['json']['FILE']
        self.items = {}
        
        for data in json.load(open(self.filename)):
            id_ = data.pop('id')
            self.items[tuple(id_)] = json.dumps(data)
        
        print('JsonStore items loaded:')
        for id, data in self.items.items():
            print(id, data)
    
class YamlStore(FileStore):
    """Items stored in a YAML file. For use during development only."""
    
    def __init__(self, filename = None):
        self.filename = filename or DATABASES['yaml']['FILE']
        self.items = {}
        
        for data in yaml.safe_load(open(self.filename)):
            id_ = data.pop('id')
            if not id_: continue            # if ID is null or empty [], treat this item as a draft that should be omitted
            self.items[tuple(id_)] = json.dumps(data)
        
        print('YamlStore items loaded:')
        for id, data in self.items.items():
            print(id, data)
    
    